/**
 * The AI capability layer's shared surface.
 *
 * Everything here is a general fact about calling models, never a fact about our company.
 * Company facts stay in the app so this package can be published later without carrying
 * them along.
 *
 * No Korean text lives here, not even in comments. Callers supply their own labels,
 * because a package that ships wording decides the wording of every screen that uses it.
 */

export {
  AI_CONTRACT_VERSION,
  type AiContractVersion,
  type AiEvidence,
  type AiSource,
  type AiValueStatus,
  type AiCorrection,
  type AiValue,
  type NewAiValueInput,
  canTransition,
  newAiValue,
  versionOf,
  isAiValue,
  applyCorrection,
} from './contract.ts'

export {
  AI_CAPABILITIES,
  type AiCapability,
  REQUIRED_PRESENTATION,
  isAiCapability,
} from './capability.ts'

export {
  type Rung,
  type Climbed,
  type Held,
  type ClimbResult,
  climb,
  isCurrent,
} from './ladder.ts'
