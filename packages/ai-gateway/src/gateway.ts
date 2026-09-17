/**
 * The one door out.
 *
 * ## Why there can only be one
 *
 * If grading, masking and recording sit at each call site, missing one of them at a single
 * site is enough for a document to leave through that path, and the missed site is found
 * only after the incident. So code that calls a model does not live outside this file.
 *
 * ## The order is the rule
 *
 * gate -> mask -> check what is left -> call -> record -> restore
 *
 * The gate comes before masking because masking makes a document that may be sent safer;
 * it does not make a document that may not be sent sendable.
 *
 * ## What the gate decides is not this package's business
 *
 * Which document grades may reach which vendor is a fact about the company running this,
 * not about calling models. So the decision is injected and the rest of the order is fixed here.
 *
 * ## A refusal leaves no record
 *
 * The transfer log answers "what went out". Writing down what never went out makes that
 * log unusable as evidence.
 */

import { AI_CONTRACT_VERSION, type AiContractVersion } from '@ax/ai-core'
import { maskPii, unmaskPii, hasUnmaskedPii, countByKind, type PiiHit } from './mask.ts'
import { costKrw, type CallableModel } from './cost.ts'

/*
  Re-exported because a caller writing a model type has to name this shape, and reaching past
  this module into ./cost.ts for it makes the cost file part of the public surface by accident.
*/
export type { CallableModel }
import { type Receipt } from './store.ts'

export class TransferBlockedError extends Error {
  readonly reason: string
  readonly modelId: string
  constructor(modelId: string, reason: string) {
    super(`this document grade may not be sent to this model: ${reason}`)
    this.name = 'TransferBlockedError'
    this.reason = reason
    this.modelId = modelId
  }
}

/**
 * The whole chain was tried and none of it worked.
 *
 * It carries the last reason. Keeping only "3 attempts" tells nobody why, and that is
 * exactly why the cause of nine failed calls in a row could not be found.
 */
export class NoModelAvailableError extends Error {
  readonly tried: string[]
  readonly lastError: string | null
  constructor(tried: string[], lastError: unknown = null) {
    const why = lastError === null ? '' : `: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    super(`no usable model (${tried.length} tried)${why}`)
    this.name = 'NoModelAvailableError'
    this.tried = tried
    this.lastError = lastError === null ? null
      : (lastError instanceof Error ? lastError.message : String(lastError))
  }
}

export interface CallRequest<C extends string = string> {
  orgId: string
  caseId: string | null
  /** The caller's own grading vocabulary. This package never interprets it */
  docClass: C
  /** What the call is for. It lands in the log and cost is counted by this unit */
  purpose: string
  prompt: string
  /** Whether an administrator approved an exception for this case */
  adminApproved?: boolean
  maxOutputTokens?: number
}

export interface RawCallResult {
  text: string
  inputTokens: number
  outputTokens: number
}

/** The function that actually reaches a vendor. An adapter is plugged in here */
export type ModelCaller<M extends CallableModel, C extends string> =
  (model: M, prompt: string, req: CallRequest<C>) => Promise<RawCallResult>

export type GateDecision =
  | { allowed: true; internal: boolean }
  | { allowed: false; reason: string }

/** May this document go to this model. Supplied by the caller, never decided here */
export type TransferGate<M extends CallableModel, C extends string> =
  (model: M, req: CallRequest<C>) => GateDecision

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

export interface TransferRecord<C extends string = string> {
  orgId: string
  caseId: string | null
  modelId: string
  docClass: C
  purpose: string
  /** What was masked. The values are never kept */
  maskedCounts: Record<string, number>
  bytes: number
}

/**
 * The recording desk, kept narrow so a test can plug in a fake.
 *
 * Both methods return a receipt. An implementation that means to record nothing has to
 * say so with a reason, which is what stops an empty body from becoming an empty ledger.
 */
export interface GatewayStore<C extends string = string> {
  recordCall(r: LlmCallRecord): Promise<Receipt>
  recordTransfer(r: TransferRecord<C>): Promise<Receipt>
}

export interface CallMeta {
  /** Which contract this result was written under. Stamped at production, not at read */
  contractVersion: AiContractVersion
  modelId: string
  modelName: string
  /** The models tried before this one, when it succeeded as a fallback */
  fallbackFrom: string[]
  internal: boolean
  latencyMs: number
  costKrw: number
  maskedCounts: Record<string, number>
  /** What the call ledger said. Null only when the call never reached a model */
  callReceipt: Receipt | null
  /** What the transfer ledger said. Null when nothing left our side at all */
  transferReceipt: Receipt | null
}

export interface CallResult {
  text: string
  meta: CallMeta
}

export interface GatewayDeps<M extends CallableModel, C extends string> {
  store: GatewayStore<C>
  call: ModelCaller<M, C>
  gate: TransferGate<M, C>
  now?: () => number
}

/**
 * Walks the chain in order.
 *
 * Moving to the next model on failure re-runs the gate every time. Without that, a
 * fallback is a leak.
 */
export async function callWithFallback<M extends CallableModel, C extends string>(
  chain: readonly M[],
  req: CallRequest<C>,
  deps: GatewayDeps<M, C>,
): Promise<CallResult> {
  const now = deps.now ?? (() => Date.now())
  const tried: string[] = []
  let lastError: unknown = null

  for (const model of chain) {
    // 1. the grade gate, which comes before masking
    const gate = deps.gate(model, req)
    if (!gate.allowed) {
      // A refusal is not written to the transfer log, because nothing left
      tried.push(model.id)
      lastError = new TransferBlockedError(model.id, gate.reason)
      continue
    }

    // 2. mask  3. check what is left
    const masked = maskPii(req.prompt)
    if (!gate.internal && hasUnmaskedPii(masked.text)) {
      tried.push(model.id)
      lastError = new TransferBlockedError(model.id, 'pii_not_masked')
      continue
    }
    const promptToSend = gate.internal ? req.prompt : masked.text

    const started = now()
    try {
      // 4. call
      const raw = await deps.call(model, promptToSend, req)
      const latencyMs = now() - started
      const cost = costKrw(model, raw.inputTokens, raw.outputTokens)

      // 5. record, and only a successful call reaches the transfer log
      const callReceipt = await deps.store.recordCall({
        orgId: req.orgId, caseId: req.caseId, modelId: model.id, purpose: req.purpose,
        inputTokens: raw.inputTokens, outputTokens: raw.outputTokens,
        costKrw: cost, latencyMs, ok: true, error: null,
      })
      const transferReceipt = gate.internal ? null : await deps.store.recordTransfer({
        orgId: req.orgId, caseId: req.caseId, modelId: model.id, docClass: req.docClass,
        purpose: req.purpose, maskedCounts: countByKind(masked.hits),
        bytes: byteLength(promptToSend),
      })

      // 6. restore
      return {
        text: gate.internal ? raw.text : unmaskPii(raw.text, masked.hits),
        meta: {
          contractVersion: AI_CONTRACT_VERSION,
          modelId: model.id,
          modelName: model.modelName,
          // Which models refused stays in the result. Without it nobody can tell why it was slow
          fallbackFrom: tried.slice(),
          internal: gate.internal,
          latencyMs,
          costKrw: cost,
          maskedCounts: countByKind(masked.hits),
          callReceipt,
          transferReceipt,
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

function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8')
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Re-applies the placeholders, for post-processing done outside the chain */
export function remask(text: string, hits: readonly PiiHit[]): string {
  let out = text
  for (const h of hits) out = out.split(h.value).join(h.token)
  return out
}
