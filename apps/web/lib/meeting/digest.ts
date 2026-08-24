/**
 * 회의 정리 — 순수 계산 (SSOT).
 *
 * AI 호출·DB 는 `digest-run.ts` 가 한다. 여기 있는 것은 전부 입력만 주면 답이 나오는 함수라
 * 단위로 잠글 수 있다 — 화면에서만 검증 가능한 식을 컴포넌트 안에 두지 않는다(E-6).
 */

import { isFactOrigin, type FactOrigin } from './digest-prompt.ts'
import { segmentsToPlain, groupSegmentsByPart, type TranscriptSegment } from './transcript.ts'

export interface DigestFact {
  text: string
  origin: FactOrigin
  /** 전사 근거. 화면에서 누르면 그 대목으로 간다 */
  segmentIds: string[]
}

export interface DigestAgendaItem {
  title: string
  facts: DigestFact[]
}

export interface DigestConflict {
  memo: string
  transcript: string
  segmentIds: string[]
}

export interface DigestResult {
  agenda: DigestAgendaItem[]
  decisions: DigestFact[]
  conflicts: DigestConflict[]
}

export const EMPTY_DIGEST: DigestResult = { agenda: [], decisions: [], conflicts: [] }

/* ── 파싱 ─────────────────────────────────────────────── */

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * 근거 id 를 실제 전사에 있는 것만 남긴다.
 *
 * **지어낸 id 를 그대로 두면** 화면에서 근거를 눌렀을 때 아무 데도 안 간다.
 * CRM 5축이 같은 자리에서 같은 실수를 했고, 거기서도 실재 검증으로 막았다.
 */
function keepRealIds(v: unknown, known: Set<string>): string[] {
  if (known.size === 0) return []
  return asArray(v).map(str).filter((id) => id.length > 0 && known.has(id))
}

function parseFact(v: unknown, known: Set<string>): DigestFact | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const text = str(o.text)
  if (!text) return null
  return {
    text,
    // 출처를 못 읽으면 memo 로 접지 않는다 — 모르는 것을 안다고 말하면 안 된다.
    // 전사가 아예 없으면 memo 가 사실이고, 있으면 both 가 가장 덜 틀린 답이다.
    origin: isFactOrigin(o.origin) ? o.origin : (known.size === 0 ? 'memo' : 'both'),
    segmentIds: keepRealIds(o.segmentIds, known),
  }
}

/** AI 응답을 우리 구조로. 못 읽는 조각은 버리되 **전체를 버리지 않는다** */
export function parseDigestResult(raw: unknown, knownSegmentIds: string[] = []): DigestResult {
  const known = new Set(knownSegmentIds)
  if (typeof raw !== 'object' || raw === null) return EMPTY_DIGEST
  const o = raw as Record<string, unknown>

  const agenda: DigestAgendaItem[] = []
  for (const item of asArray(o.agenda)) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    const facts = asArray(rec.facts)
      .map((f) => parseFact(f, known))
      .filter((f): f is DigestFact => f !== null)
    // 사실이 하나도 없는 안건은 제목만 남는다 — 화면에 빈 칸을 만들지 않는다
    if (facts.length === 0) continue
    const title = str(rec.title)
    agenda.push({ title: title || '기타', facts })
  }

  const decisions = asArray(o.decisions)
    .map((d) => parseFact(d, known))
    .filter((d): d is DigestFact => d !== null)

  const conflicts: DigestConflict[] = []
  for (const c of asArray(o.conflicts)) {
    if (typeof c !== 'object' || c === null) continue
    const rec = c as Record<string, unknown>
    const memo = str(rec.memo)
    const transcript = str(rec.transcript)
    // 한쪽만 있으면 어긋남이 아니다 — 그냥 한쪽에만 있는 사실이고 그건 agenda 의 일이다
    if (!memo || !transcript) continue
    conflicts.push({ memo, transcript, segmentIds: keepRealIds(rec.segmentIds, known) })
  }

  return { agenda, decisions, conflicts }
}

/**
 * 저장해 둔 정리본을 되읽는다.
 *
 * `parseDigestResult` 와 다른 점 하나: **근거 id 를 다시 거르지 않는다.**
 * 저장 시점에 이미 실재 검증을 통과한 값이고, 여기서 또 거르려면 그때의 전사 id 목록이
 * 필요한데 그건 지금 없다 — 없다고 빈 배열로 접으면 이력에서 근거가 통째로 사라진다.
 */
export function parseStoredDigest(bundle: unknown, decisionsPlain: string): DigestResult {
  const o = (typeof bundle === 'object' && bundle !== null ? bundle : {}) as Record<string, unknown>
  const agenda: DigestAgendaItem[] = []
  for (const item of asArray(o.agenda)) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    const facts = asArray(rec.facts).map((f) => {
      if (typeof f !== 'object' || f === null) return null
      const fr = f as Record<string, unknown>
      const text = str(fr.text)
      if (!text) return null
      return {
        text,
        origin: isFactOrigin(fr.origin) ? fr.origin : ('both' as FactOrigin),
        segmentIds: asArray(fr.segmentIds).map(str).filter(Boolean),
      }
    }).filter((f): f is DigestFact => f !== null)
    if (facts.length === 0) continue
    agenda.push({ title: str(rec.title) || '기타', facts })
  }

  const stored = asArray(o.decisions)
    .map((d) => {
      if (typeof d !== 'object' || d === null) return null
      const dr = d as Record<string, unknown>
      const text = str(dr.text)
      if (!text) return null
      return {
        text,
        origin: isFactOrigin(dr.origin) ? dr.origin : ('both' as FactOrigin),
        segmentIds: asArray(dr.segmentIds).map(str).filter(Boolean),
      }
    })
    .filter((d): d is DigestFact => d !== null)

  // 구조가 없던 옛 행은 평문에서 되살린다(하위호환) — 이력이 비어 보이면 안 된다
  const decisions = stored.length > 0
    ? stored
    : decisionsPlain.split('\n').map((l) => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean)
        .map((text) => ({ text, origin: 'memo' as FactOrigin, segmentIds: [] }))

  const conflicts: DigestConflict[] = []
  for (const c of asArray(o.conflicts)) {
    if (typeof c !== 'object' || c === null) continue
    const rec = c as Record<string, unknown>
    const memo = str(rec.memo)
    const transcript = str(rec.transcript)
    if (!memo || !transcript) continue
    conflicts.push({ memo, transcript, segmentIds: asArray(rec.segmentIds).map(str).filter(Boolean) })
  }

  return { agenda, decisions, conflicts }
}

/* ── 평문 사본 ────────────────────────────────────────── */

/**
 * `meeting_notes.summary` 에 넣을 평문.
 *
 * 이 컬럼을 읽는 곳이 여섯이다(CRM 발행 스냅샷·목록 배지·내보내기·주간보고 등).
 * 구조를 못 읽는 그 소비처들을 위해 **기존 회의록 서식 그대로** 쓴다 —
 * `[안건]` 한 줄 + `- 사실` 줄. v0.7.571 이 정한 모양이고 바꾸면 그 여섯이 다르게 보인다.
 */
export function digestToPlainSummary(agenda: DigestAgendaItem[]): string {
  return agenda
    .map((a) => [`[${a.title}]`, ...a.facts.map((f) => `- ${f.text}`)].join('\n'))
    .join('\n\n')
}

export function digestDecisionsToPlain(decisions: DigestFact[]): string {
  return decisions.map((d) => `- ${d.text}`).join('\n')
}

/* ── 긴 회의: 구간 분할 ───────────────────────────────── */

/**
 * 한 번에 보낼 수 있는 전사 길이의 상한(문자).
 *
 * 유도: 출력 상한이 32,768 토큰이고, 입력이 그보다 훨씬 크면 모델이 중간에서 자른다.
 * 한국어는 대략 1토큰 ≈ 1.5자라 24,000토큰 ≈ 36,000자를 안전선으로 잡는다.
 * ⚠️ 이 값은 **문서에서 유도한 값이고 아직 실측 앵커가 없다**(E-6).
 * 60분 회의 실측이 생기면 그 한 쌍을 `digest.test.ts` 에 단정으로 박고 이 경고를 지운다.
 */
export const DIGEST_SINGLE_PASS_MAX_CHARS = 36_000

export interface DigestChunk {
  partIdx: number
  text: string
}

export interface DigestPlan {
  /** 'single' 이면 전사를 통째로, 'map-reduce' 면 구간별로 먼저 줄인다 */
  mode: 'single' | 'map-reduce'
  chunks: DigestChunk[]
  /** 전사 전체 문자 수 — 화면·로그가 "왜 나눴는지" 말할 수 있게 */
  totalChars: number
}

/**
 * 전사 줄 앞에 구간 id 를 붙인다 — AI 가 근거를 댈 유일한 수단이다.
 * 붙이지 않으면 모델은 근거를 지어내거나 비운다(둘 다 나쁘다).
 */
export function withIdMarkers(segments: TranscriptSegment[]): string {
  return segments.map((s) => `[${s.id}] ${s.speaker}: ${s.text}`).join('\n')
}

/**
 * 전사를 한 번에 보낼지, 구간별로 먼저 줄일지 정한다.
 *
 * 경계를 새로 만들지 않는다 — `meeting_recording_part` 가 이미 10분 단위다.
 * 새 경계를 만들면 근거 시각과 구간이 어긋난다.
 */
export function planDigest(segments: TranscriptSegment[]): DigestPlan {
  const groups = groupSegmentsByPart(segments)
  const chunks: DigestChunk[] = groups.map((g) => ({
    partIdx: g.partIdx,
    text: withIdMarkers(g.segments),
  }))
  const totalChars = chunks.reduce((n, c) => n + c.text.length, 0)
  return {
    mode: totalChars > DIGEST_SINGLE_PASS_MAX_CHARS ? 'map-reduce' : 'single',
    chunks,
    totalChars,
  }
}

/** 한 번에 보내는 경우의 전사 본문 */
export function fullTranscriptForPrompt(segments: TranscriptSegment[]): string {
  return withIdMarkers(segments)
}

/** 구간 압축 결과를 종합 입력으로 다시 잇는다 */
export function condensedToTranscript(
  parts: { partIdx: number; facts: { text: string; segmentIds: string[] }[] }[],
): string {
  return parts
    .filter((p) => p.facts.length > 0)
    .map((p) => {
      const head = `[${p.partIdx * 10}분~${(p.partIdx + 1) * 10}분]`
      const lines = p.facts.map((f) => {
        const ids = f.segmentIds.length > 0 ? ` ${f.segmentIds.map((i) => `[${i}]`).join('')}` : ''
        return `- ${f.text}${ids}`
      })
      return [head, ...lines].join('\n')
    })
    .join('\n\n')
}

/** 구간 압축 응답 파싱 — 실패한 구간은 빈 배열이 되고 나머지는 산다 */
export function parseCondensedFacts(
  raw: unknown,
  known: Set<string>,
): { text: string; segmentIds: string[] }[] {
  if (typeof raw !== 'object' || raw === null) return []
  const o = raw as Record<string, unknown>
  return asArray(o.facts)
    .map((f) => {
      if (typeof f !== 'object' || f === null) return null
      const rec = f as Record<string, unknown>
      const text = str(rec.text)
      if (!text) return null
      return { text, segmentIds: keepRealIds(rec.segmentIds, known) }
    })
    .filter((f): f is { text: string; segmentIds: string[] } => f !== null)
}

/** 무엇을 읽고 만들었나 — 정리본에 함께 저장한다(재현·감사) */
export interface DigestSources {
  memoChars: number
  transcriptSegments: number
  partIdxs: number[]
  mode: DigestPlan['mode']
}

export function describeSources(
  memo: string,
  segments: TranscriptSegment[],
  mode: DigestPlan['mode'],
): DigestSources {
  return {
    memoChars: memo.trim().length,
    transcriptSegments: segments.length,
    partIdxs: Array.from(new Set(segments.map((s) => s.partIdx))).sort((a, b) => a - b),
    mode,
  }
}

/** 전사가 아예 없으면 기존 요약 경로로 위임한다 — 새 프롬프트를 억지로 쓰지 않는다 */
export function needsLegacySummary(segments: TranscriptSegment[]): boolean {
  return segments.length === 0
}

/** 사실 한 줄이라도 나왔나 — 0건이면 화면이 "못 찾았다"고 말한다 */
export function isEmptyDigest(d: DigestResult): boolean {
  return d.agenda.every((a) => a.facts.length === 0) && d.decisions.length === 0
}

/** 정리에 쓸 전사 평문(구간 id 없이) — 로그·내보내기용 */
export function plainTranscript(segments: TranscriptSegment[]): string {
  return segmentsToPlain(segments)
}
