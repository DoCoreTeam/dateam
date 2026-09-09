/**
 * 미팅 상태의 말과 색 — SSOT
 *
 * **왜 필요한가**: 예전 목록은 `summaryMd` 하나만 보고 '정리됨' 아니면 '전사 대기'라고 했다.
 * 그런데 그 둘 사이에 실제로 일어나는 일이 넷이나 있다 — 올라갔지만 아직 안 읽었고,
 * 지금 읽는 중이고, 다 읽었고, 읽다 실패했다. 그걸 전부 '전사 대기' 한 마디로 덮으면
 * **한 시간째 멈춰 있는 것과 방금 시작한 것이 같은 말**로 보인다. 사용자는 무엇을 기다리는지
 * 알 수 없고, 실패한 건은 영원히 발견되지 않는다.
 *
 * 파일로 뺀 이유는 §2-5 다 — 목록과 상세가 각자 판정하면 같은 미팅이 화면마다 다른 말이 된다.
 */

import type { StatusKey } from '../../tokens/status-colors.ts'

/** 화면이 부르는 미팅 상태. DB 컬럼이 아니라 **읽는 시점 판정**이다 */
export type MeetingStatusKey = 'SUMMARIZED' | 'TRANSCRIBED' | 'TRANSCRIBING' | 'FAILED' | 'EMPTY'

export const MEETING_STATUS_META: Record<MeetingStatusKey, { label: string; status: StatusKey }> = {
  SUMMARIZED: { label: '정리됨', status: 'done' },
  TRANSCRIBED: { label: '전사됨', status: 'doing' },
  TRANSCRIBING: { label: '전사 중', status: 'planned' },
  FAILED: { label: '전사 실패', status: 'blocker' },
  EMPTY: { label: '기록 없음', status: 'note' },
}

/** 필터 순서 — 사람이 겪는 순서 그대로다(비었다 → 읽는 중 → 읽었다 → 정리됐다, 실패는 끝에) */
export const MEETING_STATUS_ORDER: MeetingStatusKey[] = [
  'EMPTY', 'TRANSCRIBING', 'TRANSCRIBED', 'SUMMARIZED', 'FAILED',
]

export interface MeetingStatusInput {
  summaryMd: string | null
  /** 이 미팅에 달린 녹음/전사의 상태들 */
  recordingStatuses: string[]
}

/**
 * 이 미팅을 화면에서 뭐라고 부를 것인가.
 *
 * 우선순위가 곧 정책이다:
 *   ① 정리됐으면 정리됨 — 앞 단계가 어떻든 사용자가 원한 결과는 나왔다
 *   ② 하나라도 읽혔으면 전사됨 — 일부 실패는 상세에서 보이고, 목록은 "쓸 수 있다"를 말한다
 *   ③ 아직 읽는 중인 게 있으면 전사 중
 *   ④ 전부 실패면 실패 — 이 자리를 안 만들면 실패가 '대기'로 위장돼 영영 안 보인다
 *   ⑤ 아무것도 없으면 기록 없음
 */
export function meetingStatusKey(row: MeetingStatusInput): MeetingStatusKey {
  if (row.summaryMd && row.summaryMd.trim()) return 'SUMMARIZED'
  const s = row.recordingStatuses
  if (s.length === 0) return 'EMPTY'
  if (s.includes('SUMMARIZED') || s.includes('TRANSCRIBED')) return 'TRANSCRIBED'
  if (s.includes('UPLOADED') || s.includes('TRANSCRIBING')) return 'TRANSCRIBING'
  if (s.every((x) => x === 'FAILED')) return 'FAILED'
  return 'EMPTY'
}

/** 모르는 상태가 와도 화면이 비지 않게 */
export function meetingStatusMeta(row: MeetingStatusInput): { label: string; status: StatusKey } {
  return MEETING_STATUS_META[meetingStatusKey(row)] ?? MEETING_STATUS_META.EMPTY
}

/**
 * 끝났나 — **위 상태와 다른 축이다.**
 *
 * 사용자 지적(2026-09-09): *"작성 중인 폼과 작성이 완료 된 폼과 전혀 변화가 없어서 구분이 안되는데"*
 *
 * 끝냄을 위 다섯 값에 끼워 넣지 않는 이유: 그러면 **한 배지가 두 가지를 뜻하게 된다.**
 * 「정리됨」과 「끝남」은 함께 참일 수 있는데, 한 자리에 우겨넣으면 하나가 다른 하나를 덮어
 * 「정리가 됐나」를 잃는다. 같은 자리의 값은 뜻이 하나여야 한다.
 *
 * **끝나지 않았으면 `null` 이다** — 「진행 중」 배지를 따로 그리지 않는다.
 * 아직 안 끝난 것이 기본 상태라, 그걸 배지로 알리면 화면이 늘 시끄럽다.
 * 배지는 «달라진 것»에만 붙는다.
 */
export interface MeetingFinishView {
  label: string
  status: StatusKey
  /** 마우스를 올렸을 때 나오는 말 — 언제 끝냈는지까지 밝힌다 */
  title: string
}

export function meetingFinishView(
  endedAt: string | null | undefined,
  formatWhen: (iso: string) => string,
): MeetingFinishView | null {
  if (!endedAt) return null
  return { label: '끝남', status: 'done', title: `${formatWhen(endedAt)}에 끝냈어요` }
}
