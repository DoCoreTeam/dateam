/**
 * The AI capability layer's shared surface.
 *
 * Everything here is a general fact about calling models, never a fact about our
 * company. Company facts stay in the app so this package can be published later
 * without carrying them along.
 *
 * No Korean text lives here, not even in comments. Callers supply their own labels,
 * because a package that ships wording decides the wording of every screen that uses it.
 */

/**
 * The shape number every AI result carries.
 *
 * It is stamped when a result is produced, not when it is read. A result written
 * without one can never be upgraded later, because nothing records which rules
 * it was written under. That is why this exists before the first value is stored.
 */
export const AI_CONTRACT_VERSION = 1 as const

export type AiContractVersion = typeof AI_CONTRACT_VERSION
