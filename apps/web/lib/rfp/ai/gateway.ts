/**
 * AI 게이트웨이 붙임쇠 (설계서 3.6.2, 3.13.1)
 *
 * 관문 자체는 `@ax/ai-gateway` 에 있다(v0.10.0 이관). 시간 제한, 마스킹, 폴백, 비용,
 * 전송 기록의 순서는 거기서 고정된다.
 *
 * 여기 남는 것은 하나뿐이다. **어느 문서 등급이 어느 모델까지 갈 수 있나** 는
 * 우리 회사 사실이지 모델 호출의 일반 문제가 아니다. 그래서 패키지는 그 판단을
 * 함수로 받고, 이 파일이 `lib/rfp/domain/doc-class.ts` 의 규칙을 끼워 넣는다.
 *
 * 호출처 넷은 이 파일의 `callWithFallback` 을 그대로 부른다. 등급 규칙이 바뀌어도
 * 호출처는 안 바뀌고, 관문 순서가 바뀌어도 이 파일은 안 바뀐다.
 */

import {
  callWithFallback as callGateway,
  type CallRequest as GatewayCallRequest,
  type CallResult,
  type GatewayDeps as GatewayCoreDeps,
  type GatewayStore as GatewayCoreStore,
  type TransferRecord as GatewayTransferRecord,
  type GateDecision,
  type ModelCaller as GatewayModelCaller,
} from '@ax/ai-gateway'
import { decideTransfer, type DocClass, type TransferDecision } from '../domain/doc-class.ts'
import { type AiModel } from './models.ts'
import { resolveBudgetGate } from '../../ai/guarded-call.ts'
import { BudgetDeniedError } from '../../ai/budget.ts'

export {
  TransferBlockedError,
  NoModelAvailableError,
  remask,
  type RawCallResult,
  type LlmCallRecord,
  type CallMeta,
  type CallResult,
} from '@ax/ai-gateway'

/** 우리 등급 어휘로 좁힌 이름들 */
export type CallRequest = GatewayCallRequest<DocClass>
export type TransferRecord = GatewayTransferRecord<DocClass>
export type GatewayStore = GatewayCoreStore<DocClass>
export type ModelCaller = GatewayModelCaller<AiModel, DocClass>

/** 호출처는 창구와 호출 함수만 준다. 등급 관문은 이 파일이 끼운다 */
export type GatewayDeps = Omit<GatewayCoreDeps<AiModel, DocClass>, 'gate'>

/** 이 모델에 이 문서를 보내도 되나 */
function docClassGate(model: AiModel, req: CallRequest): GateDecision {
  const d: TransferDecision = decideTransfer({
    docClass: req.docClass,
    allowedDocClasses: model.allowedDocClasses,
    retention: model.retention,
    adminApproved: req.adminApproved,
    internal: model.internal,
  })
  return d.allowed ? { allowed: true, internal: d.internal } : { allowed: false, reason: d.reason }
}

/**
 * 이 창구의 예산 이름.
 *
 * 관문 쪽 `purpose` 는 «무엇을 하려고» 이고 예산은 «어느 기능» 단위다. RFP 의 AI 는
 * 한 예산을 나눠 쓰므로 여기서 한 이름으로 묶는다. 나중에 갈라야 하면
 * ai_call_budget 에 줄을 더하고 이 함수만 고친다.
 */
const RFP_BUDGET_FEATURE = 'rfp'

/**
 * 등급 관문 위에 **예산 관문**을 얹는다.
 *
 * 왜 여기인가: 벤더를 부르는 길이 셋인데(가림 한 겹, Gemini 공통 호출기, 이 관문)
 * 상한을 창구마다 붙이면 언젠가 한 곳이 빠지고, 빠진 그 길로 예산 밖 호출이 나간다.
 * 실측 2026-09-20: 상한을 아는 자리가 0곳이라 하루 23,318건이 나갔고 그중 22,131건은
 * 어차피 한도로 실패했다 — 보내 봐야 못 가는 호출이었다.
 *
 * 막히면 **모델을 한 번도 안 두드리고** 던진다. 등급 관문보다 먼저 서는 이유는,
 * 예산이 없으면 어느 모델로 가든 결과가 같기 때문이다.
 */
export async function callWithFallback(
  chain: readonly AiModel[],
  req: CallRequest,
  deps: GatewayDeps,
): Promise<CallResult> {
  const gate = await resolveBudgetGate()
  const decision = await gate.check(RFP_BUDGET_FEATURE)
  if (!decision.allowed) throw new BudgetDeniedError(decision)

  return callGateway(chain, req, { ...deps, gate: docClassGate })
}
