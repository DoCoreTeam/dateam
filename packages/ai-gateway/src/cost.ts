/** The least a model has to tell us so a call can be logged and priced */
export interface CallableModel {
  id: string
  /** What the vendor calls it. This value is what gets sent */
  modelName: string
  inputKrwPerMTok: number
  outputKrwPerMTok: number
}

/** Rounded to two decimals, because the ledger is read by people */
export function costKrw(model: CallableModel, inputTokens: number, outputTokens: number): number {
  const cost = (inputTokens / 1_000_000) * model.inputKrwPerMTok
    + (outputTokens / 1_000_000) * model.outputKrwPerMTok
  return Math.round(cost * 100) / 100
}
