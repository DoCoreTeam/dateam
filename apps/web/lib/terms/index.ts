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
  ENTITY, SURFACE_LABEL, count, countOnly,
  type EntityKey, type EntityMeta, type Counter,
} from './entity.ts'

export {
  emptyTitle, failedTo, confirmDelete, notEnough,
} from './sentence.ts'
