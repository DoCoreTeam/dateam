/**
 * Building the chain of models a document may use.
 *
 * What is left out is returned with a reason rather than dropped. A screen that can only
 * say "no model available" leaves an administrator with nothing to fix.
 */

/** The least a model has to state for this choice. Callers pass their own richer shape */
export interface PickableModel<C extends string = string> {
  id: string
  enabled: boolean
  multimodal: boolean
  /** Served inside our own network, so sending to it is not an external transfer */
  internal: boolean
  /** Lower goes first */
  sortOrder: number
  allowedDocClasses: readonly C[]
}

export type ExclusionReason = 'doc_class' | 'disabled' | 'not_multimodal'

export interface ModelPick<M> {
  /** Usable models, first is preferred */
  chain: M[]
  /** Left out, with why, so a screen can explain the absence */
  excluded: { model: M; reason: ExclusionReason }[]
}

export interface PickOptions<C extends string = string> {
  docClass: C
  /** Whether the work needs to read images */
  needMultimodal?: boolean
  /** Whether to stay on internally served models only */
  internalOnly?: boolean
}

export function pickModels<C extends string, M extends PickableModel<C>>(
  models: readonly M[],
  opts: PickOptions<C>,
): ModelPick<M> {
  const chain: M[] = []
  const excluded: ModelPick<M>['excluded'] = []

  for (const m of Array.from(models).sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (!m.enabled) { excluded.push({ model: m, reason: 'disabled' }); continue }
    if (opts.needMultimodal && !m.multimodal) {
      excluded.push({ model: m, reason: 'not_multimodal' }); continue
    }
    if (opts.internalOnly && !m.internal) {
      excluded.push({ model: m, reason: 'doc_class' }); continue
    }
    // Filtered once here and again by the gateway immediately before the call.
    // Twice, because a grade can change after the chain was built
    if (!m.allowedDocClasses.includes(opts.docClass)) {
      excluded.push({ model: m, reason: 'doc_class' }); continue
    }
    chain.push(m)
  }

  return { chain, excluded }
}
