/**
 * RFP 네 층 (기획서 7절)
 *
 * ## 층을 나누는 이유
 *
 * 지금은 한 덩어리라 **어디가 틀렸는지 말할 수 없다.** 리포트가 이상하면 원문을 잘못 읽은
 * 것인지, 문서끼리 어긋난 것인지, 우리 판단이 틀린 것인지, 문장을 잘못 쓴 것인지 구분이 안 된다.
 * 층을 붙여 두면 「2층에서 갈렸다」고 말할 수 있고, 그때 고칠 자리가 하나로 좁혀진다.
 *
 * ## 어긋난 값은 사실이 아니다
 *
 * 문서마다 금액이 다르면 그중 하나를 골라 사실이라 적지 않는다. **어긋났다고 적는다.**
 * 고르는 것은 사람의 일이고, 우리가 고르면 그 근거가 화면 어디에도 안 남는다.
 */

import type { Grounding, Verification } from '../report/schema.ts'

export type RfpLayer = 'fact' | 'check' | 'judge' | 'draft'

export interface LayerMeta {
  /** 이 층이 답하는 질문 */
  question: string
  /** 이 층이 쓰는 능력 */
  capability: 'extract' | 'judge' | 'generate'
}

export const RFP_LAYERS: Record<RfpLayer, LayerMeta> = {
  fact: { question: 'what does it say', capability: 'extract' },
  check: { question: 'do the documents disagree', capability: 'judge' },
  judge: { question: 'can we do it, and is it risky', capability: 'judge' },
  draft: { question: 'how do we write the proposal', capability: 'generate' },
}

export const LAYER_ORDER: readonly RfpLayer[] = ['fact', 'check', 'judge', 'draft']

/**
 * 이 값이 어느 층까지 갔나.
 *
 * `single` 은 한 모델이 한 번 읽은 것이라 1층에 머문다.
 * 둘 이상이 본 것만 2층으로 올라가고, 사람이 고친 것은 사람의 판단이라 3층이다.
 */
export function layerOf(verification: Verification): RfpLayer {
  switch (verification) {
    case 'single': return 'fact'
    case 'agreed': return 'check'
    case 'majority': return 'check'
    case 'conflict': return 'check'
    case 'user_fixed': return 'judge'
  }
}

/**
 * 사실로 확정해도 되나.
 *
 * 어긋난 값(`conflict`)은 근거가 확인돼도 확정이 아니다. 근거가 있다는 것과
 * 문서끼리 맞다는 것은 다른 명제이고, 섞으면 **어느 문서의 근거인지** 사라진다.
 */
export function canConfirm(verification: Verification, grounding: Grounding): boolean {
  if (verification === 'conflict') return false
  return grounding === 'confirmed'
}

/** 어긋난 값을 화면이 어떻게 다뤄야 하나 */
export function isDisagreement(verification: Verification): boolean {
  return verification === 'conflict'
}

/**
 * 경쟁 제한은 **의심으로만** 적는다.
 *
 * 「특정 업체에 유리하다」는 사실 주장이고, 그 주장이 틀리면 우리가 근거 없이 남을
 * 비난한 것이 된다. 우리가 볼 수 있는 것은 조항의 모양뿐이라 거기까지만 말한다.
 */
export type CompetitionFinding = 'restriction_suspected'

export function competitionFinding(): CompetitionFinding {
  return 'restriction_suspected'
}

/** 층이 올라갈 수 있나. 건너뛰면 2층을 안 거치고 3층 판단이 나온다 */
export function canAdvance(from: RfpLayer, to: RfpLayer): boolean {
  const a = LAYER_ORDER.indexOf(from)
  const b = LAYER_ORDER.indexOf(to)
  return b === a + 1
}
