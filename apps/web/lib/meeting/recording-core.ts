/**
 * 회의 녹음 — **클라이언트도 쓰는 순수 부분** (통합 기획 §5)
 *
 * **왜 파일이 갈렸나.** 이 상수·판정은 브라우저의 녹음 훅(use-recorder)이 그대로 써야 한다.
 * 그런데 같은 파일에 드라이브 저장이 함께 있으면, 동적 `import()` 라도 번들러는 그래프를 따라가
 * `googleapis` 를 **클라이언트 번들에 끌고 들어온다** → `Can't resolve 'net'` 으로
 * 컴파일이 죽고 **앱 전체가 500** 이 된다(실측 v0.7.578: /login 까지 못 열렸다).
 *
 * 그래서 서버가 쓰는 것과 양쪽이 쓰는 것을 파일로 가른다. 값은 여전히 한 곳에만 있고
 * `recording.ts` 가 그대로 재수출하므로 기존 import 경로는 한 줄도 바뀌지 않는다(SSOT 유지).
 */

/** 한 구간의 길이. 이 값이 바뀌면 시간축 오프셋도 같이 움직인다 — 그래서 한 곳에만 둔다. */
export const PART_MS = 10 * 60 * 1000

/** 구간 하나의 상한. 10분 음성 모노 opus 는 3MB 안쪽이라 여유 있게 잡되, 본문 한도 밑이다. */
export const MAX_PART_BYTES = 4 * 1024 * 1024

/** 받아 주는 오디오 형식. Safari 는 webm 을 못 만들어 mp4 로 온다. */
export const ALLOWED_AUDIO_MIMES: readonly string[] = [
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-m4a',
  'audio/m4a',
  'audio/ogg',
]

export type PartStatus = 'UPLOADED' | 'TRANSCRIBING' | 'TRANSCRIBED' | 'FAILED'

export interface RecordingPart {
  id: string
  note_id: string
  part_idx: number
  drive_file_id: string | null
  mime: string
  duration_sec: number | null
  status: PartStatus
  error: string | null
  retry_count: number
  audio_deleted_at: string | null
  created_at: string
}

/**
 * mime 이 우리가 다룰 수 있는 것인가.
 *
 * 브라우저는 `audio/webm;codecs=opus` 처럼 파라미터를 붙여 보낸다 — 앞부분만 본다.
 * 모르는 형식을 그냥 받으면 전사 단계에서 실패하는데, 그때는 이미 회의가 끝난 뒤다.
 */
export function isAllowedAudioMime(mime: string | null | undefined): boolean {
  const base = (mime ?? '').split(';')[0].trim().toLowerCase()
  return ALLOWED_AUDIO_MIMES.includes(base)
}

/** mime → 확장자. 드라이브에서 사람이 찾아 들을 수 있어야 한다 */
export function extensionForMime(mime: string | null | undefined): string {
  const base = (mime ?? '').split(';')[0].trim().toLowerCase()
  if (base === 'audio/mp4' || base === 'audio/m4a' || base === 'audio/x-m4a') return 'm4a'
  if (base === 'audio/mpeg') return 'mp3'
  if (base === 'audio/wav') return 'wav'
  if (base === 'audio/ogg') return 'ogg'
  return 'webm'
}

/**
 * 이 구간의 전체 시간축 오프셋(ms).
 *
 * 구간마다 0 부터 다시 세면 전사를 이어 붙였을 때 시각이 뒤죽박죽이 된다.
 * 순수 함수로 뺀 이유: 화면으로 밟기 어려운 계산이라 단정으로 고정해야 한다(완료 조건 E-6).
 */
export function partOffsetMs(partIdx: number): number {
  return Math.max(0, Math.trunc(partIdx)) * PART_MS
}

export interface RecordingProgress {
  total: number
  transcribed: number
  failed: number
  /** 전부 끝났나 — 이게 true 여야 "AI로 정리하기"가 열린다 */
  done: boolean
  /** 사람이 읽는 한 줄. 부분 실패를 숨기지 않는다 */
  label: string
}

/**
 * 진행 상태를 사람 말로.
 *
 * **부분 실패를 숨기지 않는다.** "6구간 중 1구간 실패"를 말해야 사용자가
 * 전사가 왜 짧은지 안다. 조용히 5구간만 보여 주면 나머지 10분이 없어진 걸 아무도 모른다.
 */
export function summarizeProgress(parts: Pick<RecordingPart, 'status'>[]): RecordingProgress {
  const total = parts.length
  const transcribed = parts.filter((p) => p.status === 'TRANSCRIBED').length
  const failed = parts.filter((p) => p.status === 'FAILED').length
  const done = total > 0 && transcribed + failed === total

  let label: string
  if (total === 0) label = '녹음 없음'
  else if (!done) label = `전사 중 ${transcribed}/${total}구간`
  else if (failed === 0) label = `전사 완료 · ${total}구간`
  else label = `전사 완료 · ${total}구간 중 ${failed}구간 실패`

  return { total, transcribed, failed, done, label }
}

