export {
  type AiLabels,
  AI_LABEL_KEYS,
  missingLabels,
} from './labels.ts'

export {
  GeneratedNotice,
  type GeneratedNoticeProps,
} from './GeneratedNotice.tsx'

export {
  type ConfidenceView,
  type SourceView,
  type EvidenceView,
  LOW_CONFIDENCE_BELOW,
  confidenceView,
  statusText,
  isSettled,
  sourceView,
  evidenceView,
  evidenceSpan,
} from './value.ts'

export { AiValue, type AiValueProps } from './AiValue.tsx'
export { Evidence, type EvidenceProps } from './Evidence.tsx'

export {
  type Candidate,
  type DiffSide,
  type DiffRow,
  type TrailEntry,
  canConfirmCandidates,
  confirmBlockedReason,
  diffRows,
  decidableRows,
  correctionTrail,
  wasCorrected,
  canOfferSettle,
} from './review.ts'

export { CandidateList, type CandidateListProps } from './CandidateList.tsx'
export { SuggestionDiff, type SuggestionDiffProps } from './SuggestionDiff.tsx'
export { CorrectionTrail, type CorrectionTrailProps } from './CorrectionTrail.tsx'
