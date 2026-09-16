/**
 * 「미팅 끝내기」의 **단계 계약** — 무엇을 하고, 무엇이 됐다고 말하는가.
 *
 * 사용자 시나리오(2026-08-27): *"미팅이 끝나고 다음 미팅으로 이동하면서 AI가 CRM에 있는
 * 모든 데이터와 고객사 정보를 고려해서 구조화된 데이터를 채우고"*.
 * 예전에는 같은 일을 하려면 **화면 셋을 오가며 세 번 눌러야** 했다. 그래서 하나로 묶었다.
 *
 * ## 실행은 여기 없다 (2026-09-16)
 *
 * 예전엔 이 파일의 `finishMeeting` 이 한 번의 요청 안에서 정리와 5축을 잇달아 돌렸다.
 * 그 한 번이 300초 상한에 걸려 295초에 정리만 저장하고 죽었고, 5축은 `crm_ai_run` 에
 * 행 하나 못 남긴 채 사라졌다(실측 2026-09-14). 화면을 나가면 진행도 결과도 없어졌다.
 *
 * 그래서 실행을 **잡과 드레인**으로 옮겼다(`lib/crm/jobs/finish-drain.ts`).
 * 한 회차가 한 단계만 돌고 그때마다 저장하므로, 어디서 끊겨도 거기까지는 남는다.
 * 이 파일에는 «단계가 무엇인가»와 «무엇이 됐다고 말하는가»만 남긴다 —
 * 실행하는 곳이 문구까지 지으면 경로가 늘 때마다 같은 일에 다른 말이 나온다.
 *
 * **절대 도중에 멈추지 않는다.** 정리가 실패해도 5축은 시도하고, 5축이 실패해도
 * 끝난 시각은 남는다. **되돌릴 수 없는 일을 하지 않는다** — 끝난 시각은 지울 수 있고,
 * 5축 결과는 전부 제안으로 가며(절대규칙 1), 정리본은 판이 쌓일 뿐 덮어쓰지 않는다.
 */

import { listOpenQuestions, type OpenQuestion } from './ask-suggest.ts'

export type FinishStepKey = 'end' | 'digest' | 'note' | 'extract'
export type FinishStepStatus = 'done' | 'skipped' | 'failed'

export interface FinishStep {
  key: FinishStepKey
  status: FinishStepStatus
  /** 사람이 읽는 한 줄 — 화면이 문장을 새로 짓지 않는다 */
  detail: string
}

export interface FinishResult {
  steps: FinishStep[]
  /** 이미 끝나 있었으면 그때 값 그대로 */
  endedAt: string | null
  axes: Record<string, number>
  suggested: number
  dropped: number
  questions: OpenQuestion[]
}

/** 화면이 되물음을 그릴 때 쓰는 타입 — 드레인이 아니라 조회 라우트가 만든다 */
export type { OpenQuestion }
export { listOpenQuestions }

/**
 * 단계 문구 SSOT — **실행하는 곳이 문장을 짓지 않는다.**
 *
 * 같은 일에 화면마다 다른 말이 나오지 않게 하려는 것이 전부다.
 * 예전엔 `finishMeeting` 안에 인라인으로 흩어져 있었다.
 */
export const FINISH_STEP_TEXT = {
  endDone: '끝난 시각을 남겼어요.',
  endSkipped: '이미 끝난 미팅이에요.',
  endFailed: '끝난 시각을 남기지 못했어요.',
  digestSkipped: '원본 회의 기록이 없어 정리는 건너뛰었어요.',
  digestEmpty: '정리했지만 확실한 내용을 못 찾았어요.',
  digestFailed: '정리하지 못했어요.',
  noteSkippedNone: '원본 회의노트가 없어요.',
  noteDone: '회의노트를 「확정」으로 올렸어요.',
  noteAlready: '회의노트는 이미 확정이에요.',
  noteFailed: '회의노트 상태를 바꾸지 못했어요.',
  extractEmpty: '확실한 내용을 못 찾아 인박스로 보낸 건 없어요.',
  extractFailed: 'AI가 읽지 못했어요.',
} as const

/** 「안건 N건으로 정리했어요」 — 0건은 다른 말을 쓴다 */
export function digestDetail(agendaCount: number): string {
  return agendaCount === 0 ? FINISH_STEP_TEXT.digestEmpty : `안건 ${agendaCount}건으로 정리했어요.`
}

/** 「N건을 인박스로 보냈어요」 — 근거가 약해 뺀 것이 있으면 함께 밝힌다 */
export function extractDetail(total: number, suggested: number, dropped: number): string {
  if (total === 0) return FINISH_STEP_TEXT.extractEmpty
  return `${suggested}건을 인박스로 보냈어요.`
    + (dropped > 0 ? ` (근거가 분명하지 않은 ${dropped}건은 뺐습니다)` : '')
}
