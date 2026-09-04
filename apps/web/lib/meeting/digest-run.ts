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
import { summarizeMeeting } from '../gemini-meeting.ts'
import { listTranscriptSegments } from './transcript.ts'
import { buildMeetingDigestPrompt, buildPartCondensePrompt } from './digest-prompt.ts'
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
  /** 전사가 없어 기존 요약 경로로 갔나 — 화면이 "녹음 없이 정리했어요"를 말할 수 있게 */
  legacy: boolean
  /** 모델을 대체했으면 그 사실. 조용히 바꾸면 왜 결과가 다른지 아무도 모른다 */
  notice: string | null
}

/** 정리는 원문을 읽는 일이라 service_role 로 간다. 소유 확인은 호출부(API)가 이미 했다 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function admin(): any {
  return createAdminClient() as any
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
    const { summary, decisions, notice } = await summarizeMeeting({
      userId, bodyPlain: memo, apiKey, model,
    })
    const digest: DigestResult = {
      /*
        메모만 있는 회의다. 결론 한 줄은 «여러 안건에 걸친 흐름»을 잡는 것인데
        안건 구조 자체가 없으므로 만들 근거가 없다 — 빈 문자열로 두면 화면이 그 줄을 안 그린다.
        여기서 요약 첫 문장을 결론인 척 넣으면 그건 지어낸 것이다.
      */
      outcome: '',
      nextStep: '',
      // 기존 경로는 안건 구조를 안 만든다. 평문을 한 덩어리로 담아 화면이 같은 부품으로 그린다
      agenda: summary.trim() ? [{ title: '회의 내용', facts: [{ text: summary.trim(), origin: 'memo', segmentIds: [] }] }] : [],
      decisions: decisions.trim()
        ? decisions.split('\n').map((l) => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean)
            .map((text) => ({ text, origin: 'memo' as const, segmentIds: [] }))
        : [],
      conflicts: [],
    }
    const sources = describeSources(memo, segments, 'single')
    const seq = await persist(db, noteId, digest, sources, model, summary, decisions)
    return { digest, seq, sources, legacy: true, notice }
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
  })
  if (out.fallbackNotice) notice = notice ? `${notice} ${out.fallbackNotice}` : out.fallbackNotice

  const digest = parseDigestResult(out.value, segments.map((s) => s.id))
  const sources = describeSources(memo, segments, plan.mode)
  const summaryPlain = digestToPlainSummary(digest.agenda)
  const decisionsPlain = digestDecisionsToPlain(digest.decisions)
  const seq = await persist(db, noteId, digest, sources, out.model, summaryPlain, decisionsPlain)

  return { digest: isEmptyDigest(digest) ? EMPTY_DIGEST : digest, seq, sources, legacy: false, notice }
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

/** 이력 — "이전 정리 보기". 되돌릴 수 있으면 사람이 부담 없이 다시 돌린다 */
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

  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    seq: Number(r.seq),
    createdAt: String(r.created_at),
    model: (r.model as string | null) ?? null,
    sources: (r.sources as DigestSources | null) ?? null,
    digest: parseStoredDigest(r.agenda_json, String(r.decisions ?? '')),
  }))
}
