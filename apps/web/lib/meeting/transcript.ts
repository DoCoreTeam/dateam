/**
 * 전사 세그먼트 읽기 (SSOT).
 *
 * **왜 이 파일이 생겼나.** 전사는 마이그 217 부터 DB 에 쌓이고 있었는데
 * `(member)/meeting-notes/` 전체에 문자열 `transcript` 가 **0건**이었다(v0.7.588 실측).
 * 즉 받아적기는 되는데 **볼 화면이 없었다.** 그래서 읽는 경로를 여기 하나로 만든다 —
 * 화면·정리 AI·내보내기가 각자 조회하면 정렬 규칙이 셋으로 갈린다.
 *
 * **시간축의 1차 키는 `part_idx` 다.** 녹음 구간은 `start_ms` 에 오프셋(`part_idx × 10분`)이
 * 이미 더해져 있지만(마이그 217), **붙여넣기 구간은 오디오가 없어 시각이 자리표시**다.
 * `start_ms` 만으로 줄을 세우면 나중에 붙여넣은 줄이 **첫 줄 앞으로 끼어든다**
 * (실측 v0.7.593: 4번째로 넣은 줄이 목록 맨 위에 떴다).
 * 그래서 `part_idx → start_ms → idx` 로 세운다.
 */

import { partOffsetMs, type RecordingPart } from './recording-core.ts'

export interface TranscriptSegment {
  id: string
  partId: string
  /** 몇 번째 10분 구간에서 나온 말인가 — 정리 AI 가 구간별로 나눠 읽을 때 쓴다 */
  partIdx: number
  idx: number
  speaker: string
  startMs: number
  endMs: number
  text: string
}

/** supabase-js 클라이언트 최소 형태. RLS 클라이언트와 service_role 을 같은 함수로 받는다 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

/**
 * 이 회의의 전사를 시간순으로.
 *
 * 권한은 **넘겨받은 클라이언트가 정한다**. RLS 클라이언트를 주면
 * 마이그 217 의 정책(부모 회의노트의 권한을 그대로 따름)이 그대로 걸린다 —
 * 여기서 규칙을 다시 쓰면 두 벌이 되고, 한쪽만 고치는 날이 온다.
 */
export async function listTranscriptSegments(
  client: AnyClient,
  noteId: string,
): Promise<TranscriptSegment[]> {
  const { data: partRows } = await client
    .from('meeting_recording_part')
    .select('id, part_idx')
    .eq('note_id', noteId)
    .order('part_idx', { ascending: true })

  const parts = (partRows ?? []) as { id: string; part_idx: number }[]
  if (parts.length === 0) return []

  const partIdxById = new Map(parts.map((p) => [p.id, p.part_idx]))

  const { data: segRows } = await client
    .from('meeting_transcript_segment')
    .select('id, part_id, idx, speaker, start_ms, end_ms, text')
    .in('part_id', parts.map((p) => p.id))
    .order('start_ms', { ascending: true })

  const segs = (segRows ?? []) as {
    id: string; part_id: string; idx: number
    speaker: string; start_ms: number; end_ms: number; text: string
  }[]

  return sortSegments(segs.map((s) => ({
    id: s.id,
    partId: s.part_id,
    partIdx: partIdxById.get(s.part_id) ?? 0,
    idx: s.idx,
    speaker: s.speaker,
    startMs: s.start_ms,
    endMs: s.end_ms,
    text: s.text,
  })))
}

/**
 * 줄 세우기 SSOT — `part_idx → start_ms → idx`.
 *
 * DB 의 `order('start_ms')` 만으로는 부족하다: 붙여넣기 구간의 시각은 자리표시라
 * 구간이 뒤여도 값이 작다. 구간을 먼저 보지 않으면 순서가 뒤집힌다.
 */
export function sortSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return [...segments].sort((a, b) =>
    a.partIdx - b.partIdx || a.startMs - b.startMs || a.idx - b.idx)
}

/** 이 회의에서 이미 쓰인 마지막 시각 — 붙여넣기를 그 뒤에 놓기 위해 */
export function lastEndMs(segments: TranscriptSegment[]): number {
  return segments.reduce((max, s) => Math.max(max, s.endMs), 0)
}

/** `화자: 말` 줄로 잇는다 — AI 입력과 내보내기가 같은 모양을 쓰게 */
export function segmentsToPlain(segments: TranscriptSegment[]): string {
  return segments.map((s) => `${s.speaker}: ${s.text}`).join('\n')
}

/** 구간별로 묶는다. 정리 AI 가 10분 단위로 1차 압축할 때 쓰는 경계 */
export function groupSegmentsByPart(
  segments: TranscriptSegment[],
): { partIdx: number; offsetMs: number; segments: TranscriptSegment[] }[] {
  const byIdx = new Map<number, TranscriptSegment[]>()
  for (const s of segments) {
    const arr = byIdx.get(s.partIdx)
    if (arr) arr.push(s)
    else byIdx.set(s.partIdx, [s])
  }
  return Array.from(byIdx.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([partIdx, list]) => ({ partIdx, offsetMs: partOffsetMs(partIdx), segments: list }))
}

/** 화면에 쓰는 시각 표기 — `12:03` (한 시간을 넘으면 `1:12:03`) */
export function formatSegmentTime(startMs: number): string {
  const total = Math.max(0, Math.floor(startMs / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 전사에 등장하는 화자 목록(등장 순서) — 이름 교정 UI 가 쓴다 */
export function distinctSpeakers(segments: TranscriptSegment[]): string[] {
  const seen: string[] = []
  for (const s of segments) if (!seen.includes(s.speaker)) seen.push(s.speaker)
  return seen
}

/** 전사가 몇 분어치인가 — 탭 배지에 쓴다. 구간 수가 아니라 실제 끝 시각 기준 */
export function transcriptMinutes(segments: TranscriptSegment[], parts: RecordingPart[]): number {
  const lastEnd = segments.reduce((mx, s) => Math.max(mx, s.endMs), 0)
  if (lastEnd > 0) return Math.round(lastEnd / 60_000)
  const secs = parts.reduce((n, p) => n + (p.duration_sec ?? 0), 0)
  return Math.round(secs / 60)
}
