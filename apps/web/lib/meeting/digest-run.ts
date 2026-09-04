/**
 * 회의 전체 정리 실행 — **메모와 녹음을 함께 읽는다.**
 *
 * **왜 새로 만드나.** 지금까지 회의노트 AI(`summarizeMeeting`)는 본문만 읽었고,
 * CRM 5축은 전사만 읽었다. 둘을 함께 읽는 경로가 어디에도 없었다(v0.7.588 실측).
 * 사용자 지시가 정확히 그 빈칸을 가리켰다 —
 * *"작성한 회의노트와 녹음된 회의 내용을 별도로 두고 전체적으로 정리"*.
 *
 * **기존 경로를 지우지 않는다.** 녹음이 없는 회의가 대부분이고, 그 프롬프트는
 * 두 번 실패한 끝에 맞춘 계약이다(v0.7.571). 전사가 0건이면 그쪽으로 위임한다.
 *
 * 순수 계산은 전부 `digest.ts` 에 있다 — 여기는 조립과 저장만 한다.
 */

import { createAdminClient } from '../supabase/server.ts'
import { callGeminiJson } from '../ai/gemini-call.ts'
import { DEFAULT_GEMINI_MODEL } from '../ai/gemini-model.ts'
import { htmlToPlain } from '../html-to-plain.ts'
import { plainTextLength } from './memo-mode.ts'
import { summarizeMeeting } from '../gemini-meeting.ts'
import { listTranscriptSegments } from './transcript.ts'
import { buildMeetingDigestPrompt, buildPartCondensePrompt } from './digest-prompt.ts'
import { legacyDigestVersion, withLegacyFallback } from './legacy-digest.ts'
import { parseSummaryOutline, parseDecisionLines } from './summary-structure.ts'
import {
  planDigest, fullTranscriptForPrompt, parseDigestResult, parseCondensedFacts,
  condensedToTranscript, digestToPlainSummary, digestDecisionsToPlain, parseStoredDigest,
  describeSources, isEmptyDigest, EMPTY_DIGEST,
  type DigestResult, type DigestSources,
} from './digest.ts'

export interface DigestRunResult {
  digest: DigestResult
  seq: number
  sources: DigestSources
  /**
   * 전사가 없어 기존 요약 경로로 갔나.
   *
   * **화면에 알리는 값이 아니다**(v0.7.689). 녹음이 없으면 작성만으로 정리하는 것이
   * 당연한데, 예전엔 그것을 「녹음 없이 작성만으로 정리했어요」라고 변명처럼 알렸다
   * (사용자 지적: *"녹음이 없으면 당연히 작성된걸로만 하는거야"*).
   * 무엇을 읽었는지는 재료 줄(`digestMaterialLine`)이 이미 밝힌다.
   */
  legacy: boolean
  /**
   * **사용자가 알아야 하는 것** — 정리에서 내용이 빠졌을 때만.
   * 예: 「N개 구간을 읽지 못했어요. 그만큼은 정리에서 빠집니다」
   * 아무 문제 없으면 `null` 이다 — 결과가 화면에 나타나는 것이 곧 성공 신호다(E-3).
   */
  notice: string | null
  /**
   * **관리자가 알아야 하는 것** — 모델을 대체했다는 사실.
   *
   * 화면에 띄우지 않는다: 「'gemini-flash-lite-latest'로 처리했어요. 관리자 설정에서
   * 모델을 확인해 주세요」는 회의를 정리하러 온 사람이 할 수 있는 일이 아니다.
   * 같은 사실이 시스템 로그에 이미 남는다(`lib/ai/gemini-call.ts`).
   */
  modelNotice: string | null
}

/** 정리는 원문을 읽는 일이라 service_role 로 간다. 소유 확인은 호출부(API)가 이미 했다 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function admin(): any {
  return createAdminClient() as any
}

/**
 * 정리에 쓸 AI 시간 예산.
 *
 * 왜 명시하나(실측 v0.7.686): 여기는 예산을 **아예 안 걸고** 기본값(호출 60초·전체 120초)에
 * 맡기고 있었다. 그런데 라우트는 `maxDuration = 300` 을 준다 — 즉 **라우트가 아직 4분 남았는데
 * AI 사슬이 2분에 포기**했다. 405줄짜리 실제 회의로 밟아 보니 그대로 「제한 시간 초과」였다.
 * 느린 모델은 우리가 못 고치지만, 우리가 준 예산을 우리가 안 쓰는 것은 우리 몫이다.
 *
 * 구간 나눠 읽기(condense)는 여러 번 도므로 한 번당 예산을 짧게 준다 — 하나가 오래 물면
 * 뒤 구간이 통째로 굶는다.
 */
const DIGEST_CALL_MS = 120_000
const DIGEST_OVERALL_MS = 240_000
const CONDENSE_CALL_MS = 60_000
const CONDENSE_OVERALL_MS = 100_000

/**
 * 정리에 쓴 재료의 크기 — **화면과 같은 함수로 센다.**
 *
 * 왜(실측 v0.7.688): 한 화면에 「작성 750자」와 「작성 714자」가 동시에 떠 있었다.
 * 둘 다 틀린 값은 아니다 — 750 은 서버가 `body_plain`(htmlToPlain 산물, 줄바꿈·글머리표가
 * 더 붙는다)을, 714 는 화면이 태그를 뺀 본문을 센 것이다. 그런데 라벨이 둘 다 「작성 N자」라
 * 사용자에게는 **같은 것을 두 숫자로 말하는** 모순으로 보인다.
 *
 * 세는 법을 하나로 맞추면 남는 차이는 **시점 차이뿐**이다 — 정리한 뒤 본문을 고쳤다는 뜻이고,
 * 그건 숨길 게 아니라 알려야 하는 사실이다(화면이 「정리 이후 작성 N자 → M자」로 말한다).
 */
function displayChars(bodyHtml: unknown): number {
  return plainTextLength(String(bodyHtml ?? ''))
}

async function loadGeminiConfig(): Promise<{ apiKey: string; model: string }> {
  const { data } = await admin().from('org_content').select('value').eq('key', 'META').single()
  const meta = (data?.value as Record<string, unknown>) ?? {}
  return {
    apiKey: typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : '',
    model: (typeof meta.gemini_model === 'string' ? meta.gemini_model : '') || DEFAULT_GEMINI_MODEL,
  }
}

/**
 * 정리를 한 판 돌린다.
 *
 * 던지는 것: 키 없음·모델 전부 실패(`GeminiCallError`). 호출부가 사람 말로 옮긴다.
 * 던지지 않는 것: 결과가 0건인 경우 — 그건 정상 답이다("확실한 내용을 못 찾았다").
 */
export async function runMeetingDigest(noteId: string, userId: string): Promise<DigestRunResult> {
  const db = admin()

  const { data: note } = await db
    .from('meeting_notes')
    .select('body_plain, body_html')
    .eq('id', noteId).eq('user_id', userId).is('deleted_at', null)
    .maybeSingle()
  if (!note) throw new Error('회의노트를 찾을 수 없습니다.')

  const memo = (note.body_plain as string | null)?.trim() || htmlToPlain(note.body_html as string | null)
  const segments = await listTranscriptSegments(db, noteId)
  const { apiKey, model } = await loadGeminiConfig()

  // ── 전사가 없으면 기존 요약 경로. 새 프롬프트를 억지로 쓰지 않는다 ──
  if (segments.length === 0) {
    if (!memo.trim()) throw new Error('정리할 내용이 없어요. 메모를 쓰거나 녹음을 해 주세요.')
    const { summary, decisions, notice: modelNotice, usedModel, outcome, nextStep } = await summarizeMeeting({
      userId, bodyPlain: memo, apiKey, model,
    })
    const digest: DigestResult = {
      /*
        결론과 다음 할 일은 **AI 가 준 것만** 싣는다(v0.7.689).

        예전에는 여기서 `''` 로 못 박아, 정리본 15건 중 14건이 결론 빈칸이었다 —
        「연속성이 안 느껴진다」는 지적으로 만든 «이 회의는» 줄이 녹음 있는 6% 에만 있었던 것이다.
        지금은 프롬프트가 요구하고, **근거가 없으면 모델이 빈 문자열을 준다**.
        우리가 요약 첫 문장을 결론인 척 채우지 않는 계약은 그대로다(§0-2 근거 부족 문형).
      */
      outcome,
      nextStep,
      /*
        평문을 **구조로 되돌린다**(v0.7.689). 예전엔 여기서 통째로 한 덩어리에 담았고,
        그 결과 정리본 15건 중 11건이 「회의 내용」 안건 하나로 저장됐다 —
        AI 는 `[안건]⏎- 사실` 형식을 지켜 줬는데 우리가 그걸 파싱하지 않았다.
        판정은 `summary-structure.ts` 가 한다(SSOT · 무손실 가드 있음).
      */
      agenda: parseSummaryOutline(summary).map((a) => ({
        title: a.title,
        facts: a.facts.map((text) => ({ text, origin: 'memo' as const, segmentIds: [] })),
      })),
      decisions: parseDecisionLines(decisions).map((text) => ({
        text, origin: 'memo' as const, segmentIds: [],
      })),
      conflicts: [],
    }
    const sources = { ...describeSources(memo, segments, 'single'), memoChars: displayChars(note.body_html) }
    /*
      **설정 모델이 아니라 실제로 답을 낸 모델**을 남긴다(v0.7.688 정정).
      예전엔 `model`(설정값)을 적어, 사슬이 폴백한 경우 이력이 거짓이 됐다.
    */
    const seq = await persist(db, noteId, digest, sources, usedModel, summary, decisions)
    /*
      `notice: null` — 녹음 없이 정리한 것은 **알릴 일이 아니다.** 재료 줄이 이미 말한다.
      모델 대체만 따로 담아 화면 밖(로그·관리자)으로 보낸다.
    */
    return { digest, seq, sources, legacy: true, notice: null, modelNotice }
  }

  // ── 메모 + 전사 함께 읽기 ──
  const plan = planDigest(segments)
  const knownIds = new Set(segments.map((s) => s.id))
  let transcriptForPrompt: string
  let notice: string | null = null

  if (plan.mode === 'map-reduce') {
    // 60분 회의는 한 번에 못 넣는다. 구간(10분)별로 먼저 줄이고 그 결과를 종합한다.
    // 한 구간이 실패해도 나머지는 산다 — 전부 아니면 전무로 만들지 않는다.
    const condensed: { partIdx: number; facts: { text: string; segmentIds: string[] }[] }[] = []
    let failed = 0
    for (const chunk of plan.chunks) {
      try {
        const out = await callGeminiJson({
          prompt: buildPartCondensePrompt(chunk.partIdx, chunk.text),
          apiKey, model, temperature: 0.0, feature: 'meeting_digest_condense',
          timeoutMs: CONDENSE_CALL_MS, overallTimeoutMs: CONDENSE_OVERALL_MS,
        })
        condensed.push({ partIdx: chunk.partIdx, facts: parseCondensedFacts(out.value, knownIds) })
      } catch {
        failed += 1
        condensed.push({ partIdx: chunk.partIdx, facts: [] })
      }
    }
    transcriptForPrompt = condensedToTranscript(condensed)
    if (failed > 0) {
      notice = `회의가 길어 ${plan.chunks.length}개 구간으로 나눠 읽었고, 그중 ${failed}개를 읽지 못했어요. 그만큼은 정리에서 빠집니다.`
    }
  } else {
    transcriptForPrompt = fullTranscriptForPrompt(segments)
  }

  const out = await callGeminiJson({
    prompt: buildMeetingDigestPrompt({ memo, transcript: transcriptForPrompt }),
    apiKey, model, temperature: 0.1, feature: 'meeting_digest',
    timeoutMs: DIGEST_CALL_MS, overallTimeoutMs: DIGEST_OVERALL_MS,
  })
  /*
    예전엔 이 둘을 한 문장으로 이어 붙였다. 그래서 「구간을 못 읽었다」(사용자의 일)와
    「모델을 대체했다」(관리자의 일)가 같은 상자에 나란히 떴다. 성격이 다르니 자리도 다르다.
  */
  const modelNotice = out.fallbackNotice ?? null

  const digest = parseDigestResult(out.value, segments.map((s) => s.id))
  const sources = { ...describeSources(memo, segments, plan.mode), memoChars: displayChars(note.body_html) }
  const summaryPlain = digestToPlainSummary(digest.agenda)
  const decisionsPlain = digestDecisionsToPlain(digest.decisions)
  const seq = await persist(db, noteId, digest, sources, out.model, summaryPlain, decisionsPlain)

  return { digest: isEmptyDigest(digest) ? EMPTY_DIGEST : digest, seq, sources, legacy: false, notice, modelNotice }
}

/**
 * 정리본을 **쌓고**, 최신 평문 사본을 노트에 반영한다.
 *
 * 두 곳에 쓰는 이유: 표는 이력이고 컬럼은 지금 값이다.
 * 컬럼을 안 채우면 그걸 읽는 소비처 여섯 곳(CRM 발행·목록 배지·내보내기 등)이 조용히 빈다.
 */
async function persist(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  noteId: string,
  digest: DigestResult,
  sources: DigestSources,
  model: string,
  summaryPlain: string,
  decisionsPlain: string,
): Promise<number> {
  const { data: last } = await db
    .from('meeting_note_digest').select('seq').eq('note_id', noteId)
    .order('seq', { ascending: false }).limit(1)
  const seq = (((last ?? []) as { seq: number }[])[0]?.seq ?? 0) + 1

  // supabase-js 는 insert 실패를 **던지지 않는다** — 반환 오류를 반드시 본다(v0.7.583 사고)
  const { error: insErr } = await db.from('meeting_note_digest').insert({
    note_id: noteId,
    seq,
    // decisions 도 구조 그대로 담는다 — 평문 컬럼만 두면 이력에서 출처·근거가 사라진다
    /*
      결론·다음 할 일도 함께 담는다. 안 담으면 정리 직후에는 보이다가
      **새로고침하면 사라진다** — 화면에서만 사는 값은 없는 값이다.
      컬럼을 새로 만들지 않는다: 이 jsonb 는 이미 구조를 담는 자리다(마이그 불필요).
    */
    agenda_json: {
      outcome: digest.outcome, nextStep: digest.nextStep,
      agenda: digest.agenda, conflicts: digest.conflicts, decisions: digest.decisions,
    },
    decisions: decisionsPlain || null,
    sources,
    model,
  })
  if (insErr) throw new Error(`정리본을 저장하지 못했습니다: ${insErr.message}`)

  const { error: upErr } = await db.from('meeting_notes')
    .update({ summary: summaryPlain || null, decisions: decisionsPlain || null })
    .eq('id', noteId)
  if (upErr) throw new Error(`요약을 저장하지 못했습니다: ${upErr.message}`)

  return seq
}

export interface DigestVersion {
  seq: number
  createdAt: string
  model: string | null
  sources: DigestSources | null
  digest: DigestResult
}

/**
 * 이력 — "이전 정리 보기". 되돌릴 수 있으면 사람이 부담 없이 다시 돌린다.
 *
 * **표가 비면 옛 경로 산물을 메운다**(실측 16건). `meeting_notes.summary` 에만 정리가 든
 * 회의가 있고, 그 회의는 목록에서는 요약이 보이는데 상세에서는 「아직 정리하지 않았어요」라고
 * 말했다. 판정은 `legacy-digest.ts` 가 한다 — 여기서 조건식을 쓰면 검증 수단이 실브라우저뿐이다.
 */
export async function listMeetingDigests(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  noteId: string,
): Promise<DigestVersion[]> {
  const { data } = await client
    .from('meeting_note_digest')
    .select('seq, created_at, model, sources, agenda_json, decisions')
    .eq('note_id', noteId)
    .order('seq', { ascending: false })

  const versions = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    seq: Number(r.seq),
    createdAt: String(r.created_at),
    model: (r.model as string | null) ?? null,
    sources: (r.sources as DigestSources | null) ?? null,
    digest: parseStoredDigest(r.agenda_json, String(r.decisions ?? '')),
  }))
  if (versions.length > 0) return versions

  /*
    표가 비었을 때만 노트를 한 번 더 읽는다 — 정리본이 있는 회의(대부분이 될 것)는
    쿼리가 늘지 않는다. 읽기 실패는 삼킨다: 옛 정리를 못 찾는 것은 「아직 안 함」과
    같은 화면이라, 여기서 던지면 정상 동작하던 빈 상태까지 오류 상자로 바뀐다.
  */
  const { data: note } = await client
    .from('meeting_notes')
    .select('summary, decisions, updated_at')
    .eq('id', noteId)
    .maybeSingle()
  if (!note) return versions

  return withLegacyFallback(versions, () =>
    legacyDigestVersion({
      summary: note.summary as string | null,
      decisions: note.decisions as string | null,
      updatedAt: note.updated_at as string | null,
    }),
  )
}
