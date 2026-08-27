/**
 * 용어집 — 화면이 여는 한 곳 (용어집 §01 2층)
 *
 * 화면은 `@/lib/terms` 하나만 import 한다. 어느 파일에 무엇이 있는지 외울 필요가 없다.
 * 사람이 읽는 사전은 `docs/ui-system/GLOSSARY.md` 다.
 */

export {
  ACTION, BANNED_TERMS, MEETING_CAPTURE_LABEL,
  createLabel, progress,
  type ActionKey,
} from './action.ts'

export {
  ENTITY, SURFACE_LABEL, SERVICE_LABEL, count, countOnly,
  type EntityKey, type EntityMeta, type Counter, type ServiceKey, type SurfaceKey,
} from './entity.ts'

export {
  emptyTitle, failedTo, confirmDelete, notEnough,
} from './sentence.ts'

export {
  LEDGER, BOOKED_FROM_LABEL, AMOUNT_LABEL, AMOUNT_HINT,
  FUNDING_LABEL, FUNDING_AGENCY_HINT, IN_KIND_LABEL, IN_KIND_BASIS_HINT,
  TAX_BASIS_LABEL, IN_KIND_LOCKED,
  taxBasisNote, inKindShare, undatedInKindNote, yearLabel, monthsLabel, basisPlaceholder,
  BUSINESS_TYPE_LABEL, BUSINESS_TYPE_ORDER, BUSINESS_TYPE_LABEL_TEXT,
  TERM_TYPE_LABEL, TERM_TYPE_ORDER, TERM_TYPE_LABEL_TEXT,
  type BookedFromKey, type FundingKey, type InKindKindKey,
  type BusinessTypeKey, type TermTypeKey,
} from './ledger.ts'
