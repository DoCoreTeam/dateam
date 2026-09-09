/**
 * 「미팅 끝내기」가 도는 동안 화면이 무슨 말을 할지 — SSOT
 *
 * ## 왜 생겼나 (사용자 지적 2026-09-09)
 *
 * *"정리하는중에서 멈추어 보이는거는 뭔가 액티브하게 진행 중인것에 대한 표현을 해주면 되고"*
 *
 * 버튼 라벨이 처음부터 끝까지 **「정리하는 중…」 한 문장**이었다. 회의 하나를 읽는 데
 * 수십 초가 걸리는데 그동안 화면에서 움직이는 것이 하나도 없으면, 사람은 그것을
 * 「진행 중」이 아니라 **「고장」**으로 읽는다. 실제로 그 판에서 정리는 성공했고
 * 사용자는 멈춘 줄 알았다(실측: 정리본이 끝내기와 같은 시각 16:14 에 생성됨).
 *
 * 회의노트 쪽은 v0.7.684 에 이미 같은 사고를 고쳤다(`digest-progress.ts`).
 * 그런데 CRM 끝내기는 그 모듈을 쓰지 않아 **옆자리에 같은 결함이 그대로 남아 있었다.**
 * 그래서 여기서 새로 짓지 않고 **그 모듈에 위임한다** — 문구가 두 벌이 되면 같은 일에
 * 화면마다 다른 말이 나온다.
 *
 * ## 왜 컴포넌트 밖인가
 *
 * `useEffect` 안의 식은 실브라우저 말고는 검증할 수단이 없다(정책 E-6).
 * 45초·120초 분기는 브라우저로 밟기 어려운 자리라 더욱 그렇다.
 * 순수 함수로 두면 경과 시간을 인자로 넘겨 그 순간을 그대로 재현할 수 있다.
 */

import { digestProgress, formatElapsed } from '../../meeting/digest-progress.ts'

/**
 * 끝내기가 지나가는 단계.
 *
 * 순서가 곧 계약이다 — **저장이 정리보다 먼저다.** 5초 디바운스가 안 터진 글이 남은 채로
 * 정리를 시작하면 방금 적은 문장이 빠진 채 읽힌다(`lib/meeting/pending-save.ts`).
 */
export type FinishPhase = 'saving' | 'stopping' | 'working'

export const FINISH_PHASE_ORDER: FinishPhase[] = ['saving', 'stopping', 'working']

export interface FinishProgressInput {
  phase: FinishPhase
  /** `working` 에 들어선 뒤 흐른 시간. 앞 단계에서는 안 쓴다 */
  elapsedMs: number
  /** 메모 글자수 — 0 이면 메모가 없는 회의다 */
  memoChars: number
  /** 전사 줄수 — 0 이면 녹음이 없는 회의다 */
  segmentCount: number
}

export interface FinishProgressView {
  /** 지금 무엇을 하는 중인지 — 한 문장 */
  message: string
  /** 경과 시간. **앞 단계는 `null`** — 1~2초짜리에 초를 세면 그게 더 불안하다 */
  elapsedLabel: string | null
  /** 오래 걸릴 때만 붙는 덧말 */
  reassure: string | null
}

/**
 * 지금 화면에 적을 말.
 *
 * `working` 은 회의노트의 진행 문구를 **그대로 쓴다**(경과 시간 · 무엇을 읽는지 · 안심 문구).
 * 앞의 두 단계는 짧고 결과가 분명해서 시간을 셀 이유가 없다.
 */
export function finishProgress(input: FinishProgressInput): FinishProgressView {
  if (input.phase === 'saving') {
    return { message: '쓰던 내용을 먼저 저장하고 있어요', elapsedLabel: null, reassure: null }
  }
  if (input.phase === 'stopping') {
    return { message: '녹음을 멈추고 있어요', elapsedLabel: null, reassure: null }
  }

  const view = digestProgress({
    elapsedMs: input.elapsedMs,
    memoChars: input.memoChars,
    segmentCount: input.segmentCount,
  })
  return { message: view.message, elapsedLabel: view.elapsedLabel, reassure: view.reassure }
}

/**
 * 버튼에 적을 말.
 *
 * **도는 중에는 단계를 그대로 밝힌다** — 「정리하는 중…」 하나로 세 단계를 덮으면
 * 저장에서 막힌 것과 AI 가 읽는 중인 것이 같은 말이 된다.
 */
export function finishButtonLabel(phase: FinishPhase | null, hasEnded: boolean): string {
  if (phase === 'saving') return '저장하는 중…'
  if (phase === 'stopping') return '녹음 멈추는 중…'
  if (phase === 'working') return '정리하는 중…'
  return hasEnded ? '다시 정리하기' : '미팅 끝내기'
}

/**
 * 진행 줄에 시간을 함께 적을 때 쓰는 한 줄.
 * 시간이 없는 단계면 문장만 돌려준다 — **「· null」 같은 것이 화면에 나가지 않게.**
 */
export function finishProgressLine(view: FinishProgressView): string {
  return view.elapsedLabel ? `${view.message} · ${view.elapsedLabel}` : view.message
}

export { formatElapsed }
