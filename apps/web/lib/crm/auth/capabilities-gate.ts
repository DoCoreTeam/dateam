/**
 * 능력 관문 — 화면에서 숨기는 것만으로는 API 로 새어 나간다(§2-5 (3)와 같은 이유).
 */
import { CrmError } from '../domain/errors.ts'
import { hasCapability, type Viewer } from '../security/sensitivity.ts'

/** 원가·현물 명세를 고칠 수 있는가 */
export function requireCostEdit(viewer: Viewer | null | undefined): void {
  if (hasCapability(viewer, 'cost.edit')) return
  throw new CrmError('FORBIDDEN', '원가 정보를 수정할 권한이 없습니다. 관리자에게 문의해 주세요.')
}

/** 원가·현물 명세를 볼 수 있는가 */
export function requireCostView(viewer: Viewer | null | undefined): void {
  if (hasCapability(viewer, 'cost.view')) return
  throw new CrmError('FORBIDDEN', '원가 정보를 볼 권한이 없습니다.')
}
