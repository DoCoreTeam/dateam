/**
 * 시작하기 화면이 쓰는 말 — **화면 파일 안에 두지 않는다** (CEO.md §0-2)
 */

import { NOT_MEASURED } from '../../terms/index.ts'
import type { Stance, RiskView } from './onboarding.ts'

export const START_TITLE = '시작하기'
export const START_WHY = '세 가지만 정하면 나머지는 채워 드립니다. 언제든 다시 할 수 있습니다'

export const START_STANCE_Q = '얼마나 조심스럽게 갈까요'
export const START_STANCE_HINT = '신호를 얼마나 까다롭게 고를지 정합니다'
export const STANCE_LABEL: Record<Stance, string> = {
  careful: '조심스럽게',
  normal: '보통',
  bold: '적극적으로',
}

export const START_TARGET_Q = '하루에 목표하는 수익'
export const START_TARGET_HINT = '여기에 닿으면 그날은 새 신호를 멈춥니다'

export const START_LOSS_Q = '하루에 감당할 수 있는 손실'
export const START_LOSS_HINT = '여기에 닿으면 그날은 끝냅니다'

export const START_ASK = '무엇이 채워지는지 보기'
export const START_APPLY = '이대로 채우기'
export const START_FILLED_HEAD = '이렇게 채웁니다'
export const START_WHEN = '채운 값은 다음 거래일부터 듣습니다'

/** 사람이 직접 답해야 하는 값. AI 는 이 값을 못 바꿉니다 (§15.3) */
export const START_PERSON_MARK = '직접 답하신 값입니다'

/** 미리보기에서 손댄 값. 계산된 값과 화면에서 갈라 보여야 한다 */
export const START_EDITED_MARK = '고치신 값입니다'
export const START_RESET_ONE = '되돌리기'
export const START_EDIT_HINT = '값을 고치면 그 값으로 채웁니다'

/** 한 번에 얼마를 잃을 수 있나. 한도와 견줘 말합니다 (M6) */
export function riskLine(risk: RiskView): string {
  const once = risk.onceKrw.toLocaleString('ko-KR')
  const limit = risk.limitKrw.toLocaleString('ko-KR')
  if (!risk.fits) {
    return `한 번에 ${once}원을 잃을 수 있는데 한도가 ${limit}원이라 신호가 한 건도 못 나갑니다`
  }
  return `한 번에 약 ${once}원을 잃을 수 있습니다. 한도 ${limit}원 안에서 ${risk.times}번분입니다`
}

export function riskUnmeasured(): string {
  return `상품 정보를 아직 못 읽어 한 번에 얼마를 잃을 수 있는지는 ${NOT_MEASURED}입니다`
}

export function raiseWarning(): string {
  return '지금보다 손실 한도를 올리는 답입니다. 그만큼 하루에 더 잃을 수 있습니다'
}
