/**
 * AI 게이트웨이 — 외부로 나가는 **유일한 문** (설계서 3.6.2, 3.13.1)
 *
 * ## 왜 문이 하나여야 하나
 *
 * 등급 판정·마스킹·기록이 호출부마다 흩어지면, **그중 한 곳만 빠뜨려도 그 길로 문서가 나간다.**
 * 그리고 빠뜨린 곳은 사고가 난 뒤에야 찾는다. 그래서 모델을 부르는 코드는
 * 이 파일 밖에 두지 않는다.
 *
 * ## 순서가 규칙이다
 *
 * ① 등급 관문 → ② 마스킹 → ③ 남은 개인정보 확인 → ④ 호출 → ⑤ 기록 → ⑥ 복원
 *
 * 관문이 마스킹보다 먼저인 이유: 마스킹은 «보내도 되는 문서» 를 더 안전하게 만드는 것이지
 * **보내면 안 되는 문서를 보내도 되게 만들지 않는다.**
 *
 * ## 거절은 기록을 남기지 않는다
 *
 * `rfp_external_transfers` 는 «무엇이 밖으로 나갔나» 의 장부다.
 * 나가지 않은 것을 적으면 그 장부를 믿을 수 없게 된다.
 */

import { decideTransfer, type DocClass, type TransferDecision } from '../domain/doc-class.ts'
import { maskPii, unmaskPii, hasUnmaskedPii, countByKind, type PiiHit } from './mask.ts'
import { costKrw, type AiModel } from './models.ts'
import { AI_CONTRACT_VERSION, type AiContractVersion } from '@ax/ai-core'

export class TransferBlockedError extends Error {
  readonly reason: string
  readonly modelId: string
  constructor(modelId: string, reason: string) {
    super(`이 문서 등급으로는 이 모델에 보낼 수 없다: ${reason}`)
    this.name = 'TransferBlockedError'
    this.reason = reason
    this.modelId = modelId
  }
}

/**
 * 사슬을 다 돌았는데 하나도 안 됐다.
 *
 * **마지막 사유를 들고 온다.** 「시도 3개」만 남기면 왜 안 됐는지 아무도 모르고,
 * 실제로 그래서 9번 호출이 전부 실패한 원인을 못 찾았다(실측 2026-09-09).
 */
export class NoModelAvailableError extends Error {
  readonly tried: string[]
  readonly lastError: string | null
  constructor(tried: string[], lastError: unknown = null) {
    const why = lastError === null ? '' : `: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    super(`쓸 수 있는 모델이 없다 (시도 ${tried.length}개)${why}`)
    this.name = 'NoModelAvailableError'
    this.tried = tried
    this.lastError = lastError === null ? null
      : (lastError instanceof Error ? lastError.message : String(lastError))
  }
}

export interface CallRequest {
  orgId: string
  caseId: string | null
  docClass: DocClass
  /** 무엇을 하려고 부르나 — 기록에 남아 나중에 비용을 이 단위로 센다 */
  purpose: string
  prompt: string
  /** 관리자 예외 승인이 이 케이스에 걸려 있나 */
  adminApproved?: boolean
  maxOutputTokens?: number
}

export interface RawCallResult {
  text: string
  inputTokens: number
  outputTokens: number
}

/** 실제로 모델을 부르는 함수 — 벤더 어댑터가 끼워진다 */
export type ModelCaller = (model: AiModel, prompt: string, req: CallRequest) => Promise<RawCallResult>

export interface LlmCallRecord {
  orgId: string
  caseId: string | null
  modelId: string
  purpose: string
  inputTokens: number
  outputTokens: number
  costKrw: number
  latencyMs: number
  ok: boolean
  error: string | null
}

export interface TransferRecord {
  orgId: string
  caseId: string | null
  modelId: string
  docClass: DocClass
  purpose: string
  /** 무엇을 마스킹했나. **값은 남기지 않는다** */
  maskedCounts: Record<string, number>
  bytes: number
}

/** 기록 창구 — 테스트가 가짜를 끼울 수 있게 좁게 잡는다 */
export interface GatewayStore {
  recordCall(r: LlmCallRecord): Promise<void>
  recordTransfer(r: TransferRecord): Promise<void>
}

export interface CallMeta {
  /**
   * 이 결과가 어느 판의 규칙으로 만들어졌나.
   *
   * 읽을 때가 아니라 **만들 때** 박는다. 판 번호 없이 저장된 값은 나중에 올릴 수 없다 —
   * 무슨 규칙으로 쓰였는지 아무 데도 안 적혀 있기 때문이다.
   */
  contractVersion: AiContractVersion
  modelId: string
  modelName: string
  /** 1순위가 아니라 폴백으로 성공했으면 그 앞 모델들 */
  fallbackFrom: string[]
  internal: boolean
  latencyMs: number
  costKrw: number
  maskedCounts: Record<string, number>
}

export interface CallResult {
  text: string
  meta: CallMeta
}

export interface GatewayDeps {
  store: GatewayStore
  call: ModelCaller
  now?: () => number
}

/**
 * 사슬을 순서대로 시도한다.
 *
 * 장애로 다음 모델로 넘어가도 **등급 관문은 매번 다시 통과한다** —
 * 안 그러면 폴백이 곧 유출이다.
 */
export async function callWithFallback(
  chain: readonly AiModel[],
  req: CallRequest,
  deps: GatewayDeps,
): Promise<CallResult> {
  const now = deps.now ?? (() => Date.now())
  const tried: string[] = []
  let lastError: unknown = null

  for (const model of chain) {
    // ① 등급 관문 — 마스킹보다 먼저다
    const gate = gateFor(model, req)
    if (!gate.allowed) {
      // 거절은 전송 장부에 남기지 않는다. 나가지 않았기 때문이다
      tried.push(model.id)
      lastError = new TransferBlockedError(model.id, gate.reason)
      continue
    }

    // ② 마스킹 ③ 남은 것 확인
    const masked = maskPii(req.prompt)
    if (!gate.internal && hasUnmaskedPii(masked.text)) {
      tried.push(model.id)
      lastError = new TransferBlockedError(model.id, 'pii_not_masked')
      continue
    }
    const promptToSend = gate.internal ? req.prompt : masked.text

    const started = now()
    try {
      // ④ 호출
      const raw = await deps.call(model, promptToSend, req)
      const latencyMs = now() - started
      const cost = costKrw(model, raw.inputTokens, raw.outputTokens)

      // ⑤ 기록 — 성공한 호출만 전송 장부에 남는다
      await deps.store.recordCall({
        orgId: req.orgId, caseId: req.caseId, modelId: model.id, purpose: req.purpose,
        inputTokens: raw.inputTokens, outputTokens: raw.outputTokens,
        costKrw: cost, latencyMs, ok: true, error: null,
      })
      if (!gate.internal) {
        await deps.store.recordTransfer({
          orgId: req.orgId, caseId: req.caseId, modelId: model.id, docClass: req.docClass,
          purpose: req.purpose, maskedCounts: countByKind(masked.hits),
          bytes: byteLength(promptToSend),
        })
      }

      // ⑥ 복원
      return {
        text: gate.internal ? raw.text : unmaskPii(raw.text, masked.hits),
        meta: {
          contractVersion: AI_CONTRACT_VERSION,
          modelId: model.id,
          modelName: model.modelName,
          // 어느 모델이 막혔는지 결과에 남는다. 안 남기면 왜 느렸는지 아무도 모른다
          fallbackFrom: tried.slice(),
          internal: gate.internal,
          latencyMs,
          costKrw: cost,
          maskedCounts: countByKind(masked.hits),
        },
      }
    } catch (e) {
      const latencyMs = now() - started
      await deps.store.recordCall({
        orgId: req.orgId, caseId: req.caseId, modelId: model.id, purpose: req.purpose,
        inputTokens: 0, outputTokens: 0, costKrw: 0, latencyMs,
        ok: false, error: describe(e).slice(0, 1000),
      })
      tried.push(model.id)
      lastError = e
    }
  }

  if (lastError instanceof TransferBlockedError) throw lastError
  throw new NoModelAvailableError(tried, lastError)
}

/** 이 모델에 이 문서를 보내도 되나 */
function gateFor(model: AiModel, req: CallRequest): { allowed: true; internal: boolean } | { allowed: false; reason: string } {
  const d: TransferDecision = decideTransfer({
    docClass: req.docClass,
    allowedDocClasses: model.allowedDocClasses,
    retention: model.retention,
    adminApproved: req.adminApproved,
    internal: model.internal,
  })
  return d.allowed ? { allowed: true, internal: d.internal } : { allowed: false, reason: d.reason }
}

function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8')
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 마스킹한 것을 다시 씌운다 — 사슬 밖에서 후처리할 때 쓴다 */
export function remask(text: string, hits: readonly PiiHit[]): string {
  let out = text
  for (const h of hits) out = out.split(h.value).join(h.token)
  return out
}
