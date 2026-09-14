/**
 * The recording desk.
 *
 * ## Why a desk has to hand back a receipt
 *
 * Making the desk optional, or shipping one that does nothing, turns the ledger into zero
 * rows without anyone noticing. Nothing errors, nothing is logged, and "no failures" looks
 * exactly like "never ran".
 *
 * An empty function body is the same hole with extra steps, and it was real: one route
 * implemented the transfer desk as `async recordTransfer() {}` with a comment explaining
 * why nothing needed recording. The reasoning may even be right, but it left no trace, so
 * from the outside that route and a broken one are indistinguishable.
 *
 * So the desk returns a receipt. An empty body no longer type checks. Declining to record
 * is still allowed, but only by saying so, and the reason travels back with the result.
 */

/** Recorded, with whatever the store calls the row */
export interface RecordedReceipt {
  recorded: true
  id: string
}

/** Deliberately not recorded, with the reason that goes back to the caller */
export interface NotRecordedReceipt {
  recorded: false
  reason: string
}

export type Receipt = RecordedReceipt | NotRecordedReceipt

export function recorded(id: string): RecordedReceipt {
  return { recorded: true, id }
}

/**
 * States that nothing was written, and why.
 *
 * The reason must say something. An empty reason is the empty function body again,
 * so it is rejected here rather than discovered later in an empty ledger.
 */
export function notRecorded(reason: string): NotRecordedReceipt {
  if (reason.trim() === '') {
    throw new Error('a skipped recording must state a reason')
  }
  return { recorded: false, reason }
}

/** Whether a receipt means a row exists somewhere */
export function isRecorded(r: Receipt | null): boolean {
  return r !== null && r.recorded
}
