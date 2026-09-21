/**
 * 용어집 — 화면이 여는 한 곳 (용어집 §01 2층)
 *
 * 화면은 `@/lib/terms` 하나만 import 한다. 어느 파일에 무엇이 있는지 외울 필요가 없다.
 * 사람이 읽는 사전은 `docs/ui-system/GLOSSARY.md` 다.
 */

export {
  ACTION, BANNED_TERMS, MEETING_CAPTURE_LABEL,
  createLabel, progress,
  settingFieldState, SETTING_SAVE_LABEL, settingSaveDisabled,
  type ActionKey, type SettingFieldState,
} from './action.ts'

export {
  ENTITY, SURFACE_LABEL, SERVICE_LABEL, count, countOnly,
  type EntityKey, type EntityMeta, type Counter, type ServiceKey, type SurfaceKey,
} from './entity.ts'

export {
  emptyTitle, failedTo, confirmDelete, confirmDeleteParts, notEnough,
  type DeleteConfirmParts,
} from './sentence.ts'

export {
  BADGE, badgeTitle,
  type BadgeKey, type BadgeMeta,
} from './badge.ts'

export {
  DIGEST_LABEL, DIGEST_RUN_LABEL, DIGEST_RERUN_LABEL, DIGEST_STALE_LABEL,
  DIGEST_NO_MATERIAL, DIGEST_EMPTY_TITLE, FACT_ORIGIN,
  EXTRACT_LABEL, EXTRACT_RUN_LABEL,
  MEMO_LABEL, TRANSCRIPT_LABEL, EVIDENCE_LABEL, NOTE_INFO_LABEL,
  digestMaterialLine, digestStaleLine,
} from './digest.ts'

export {
  LEDGER, BOOKED_FROM_LABEL, AMOUNT_LABEL, AMOUNT_HINT,
  FUNDING_LABEL, FUNDING_AGENCY_HINT, IN_KIND_LABEL, IN_KIND_BASIS_HINT,
  TAX_BASIS_LABEL, IN_KIND_LOCKED,
  taxBasisNote, inKindShare, undatedInKindNote, yearLabel, monthsLabel, basisPlaceholder,
  BUSINESS_TYPE_LABEL, BUSINESS_TYPE_ORDER, BUSINESS_TYPE_LABEL_TEXT,
  TERM_TYPE_LABEL, TERM_TYPE_ORDER, TERM_TYPE_LABEL_TEXT,
  DEAL_STATUS_LABEL, DEAL_STATUS_ORDER, DEAL_STATUS_LABEL_TEXT,
  EXPECTED_CLOSE_LABEL, END_DATE_UNKNOWN_LABEL, END_DATE_UNKNOWN_HINT,
  type BookedFromKey, type FundingKey, type InKindKindKey,
  type BusinessTypeKey, type TermTypeKey, type DealStatusKey,
} from './ledger.ts'

export {
  QUOTE, QUOTE_LINES_LOCKED, SUPPLIER_SETUP_HINT, EXPORT_SAFE_NOTE, EXPORT_BLOCKED_NOTE, PRINT_HINT,
  SUPPLIER_LABEL, SUPPLIER_ORDER, SUPPLIER_SETTING_KEY, SUPPLIER_IMAGE_KEY, QUOTE_SETTING_KEY,
  quoteEditTitle, approvalNeeded, expiredNote, hangulAmount, sectionDefaultName,
  FILL_SPEECH_HINT, FILL_SPEECH_PLACEHOLDER, FILL_FILE_HINT, FILL_FILE_KINDS,
  FILL_REVIEW_HINT, FILL_UNCLEAR_TITLE, FILL_NO_PRICE, FILL_SOURCE_LABEL,
  FILL_NO_TABLE, FILL_TRUNCATED, FILL_READ_AS_IMAGE, FILL_NOTHING_FOUND, fillFoundLine,
  fillComponentsFold, fillDroppedComponents, fillDroppedLines, fillSourcePage, fillSheetTruncated, fillSpecSplit,
  fillFoundQuotesLine,
  fillPickTitle, fillQuoteName, FILL_PICK_BACK, FILL_PICK_ONE_ONLY,
  IMPORT_TITLE, IMPORT_FILE_HINT, IMPORT_DEST, IMPORT_DEST_HINT, type ImportDestKey,
  IMPORT_APPEND_TARGET, IMPORT_NO_APPEND_TARGET, IMPORT_OPEN, IMPORT_CLOSE,
  importSubmitLabel, importDoneLine, importFailedLine, importMixedLine, IMPORT_NOTHING_PICKED,
  FILL_READ_FAILED, FILL_FILE_LABEL, IMPORT_FAILED_UNKNOWN,
  IMPORT_COST_HINT, IMPORT_COST_ALSO_QUOTE, IMPORT_COST_ALSO_QUOTE_HINT, IMPORT_COST_ADMIN_ONLY,
  IMPORT_KEEP_FILE, IMPORT_KEEP_FILE_HINT, IMPORT_KEEP_FILE_FAILED, QUOTE_SOURCE,
  IMPORT_PRICE, IMPORT_PRICE_TITLE, IMPORT_PRICE_HINT, type ImportPriceKey,
  IMPORT_MARGIN_PLACEHOLDER, IMPORT_TARGET_TOTAL, IMPORT_TARGET_INCLUDES_TAX,
  FILL_RISK_TEXT, FILL_TOTAL_MATCH, FILL_TOTAL_NO_REFERENCE, fillTotalMismatch,
  FILL_TOTAL_OURS, FILL_TOTAL_DOCUMENT, type FillRiskKey,
  ROUNDING_MODES, roundingUnitName, roundingUnitLabel, roundingNote,
  type SupplierField, type RoundingModeKey,
} from './quote.ts'

export {
  FIT_ON, FIT_OFF, FIT_SMALLER, FIT_BIGGER, PREVIEW_CLOSE,
  fitReason, tooLongNote,
} from './doc.ts'

export {
  CONTRACT_LEGACY, CONTRACT_HELD, CONTRACT_AHEAD, contractNote,
} from './contract.ts'

export {
  AI_LABELS, NOT_AI, LOW_CONFIDENCE_HINT,
} from './ai.ts'

export {
  CONNECTION,
  type ConnectionKey,
} from './connection.ts'

export {
  AI_KEY, AI_KEY_STATUS,
  type AiKeyStatusKey,
} from './ai-key.ts'

export {
  EMPLOYMENT_STATUS, EMPLOYMENT_FIELD, EMPLOYMENT_ACTION, EMPLOYMENT_UNKNOWN,
  RESIGNED_TAB, confirmResign, confirmUndoResign,
  type EmploymentStatus, type EmploymentStatusMeta,
} from './member.ts'

export {
  SETTINGS,
} from './settings.ts'

export {
  ACCESS, ACCESS_EFFECT_LABEL, ACCESS_EFFECT_ORDER, ACCESS_EFFECT_STATUS,
  ACCESS_SUBJECT_LABEL, ACCESS_SUBJECT_ORDER,
  ACCESS_AUDIENCE_LABEL, ACCESS_AUDIENCE_STATUS,
  ACCESS_EMPTY_TITLE, ACCESS_EMPTY_HINT, ACCESS_DEFAULT_NOTE, ACCESS_DESCENDANTS_HINT,
  accessPeopleCount, accessGrantCount, accessSurfaceCount, accessSyncedLine, accessOrphanLine,
} from './access.ts'
