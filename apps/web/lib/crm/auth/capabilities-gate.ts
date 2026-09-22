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

/**
 * 임계를 넘은 할인을 승인할 수 있는가
 *
 * **왜 뒤늦게 붙는가**: `quote.approve` 는 능력 목록에도 있고 화면에 뜨는 이름도 있었는데
 * **부르는 자리가 한 곳도 없었다**(실측 2026-09-22). 승인 창구는 `withCrmApi('MEMBER')` 만
 * 보고 있어서, 멤버면 자기가 만든 초과 할인을 자기가 승인할 수 있었다.
 * 지금은 전원이 READONLY 라 사고가 안 났을 뿐이고, 멤버를 늘리는 순간 열리는 구멍이다.
 *
 * **왜 여기인가**: 원가 관문 둘과 같은 자리다. 판정을 서비스로 내리면 `approveQuote` 의
 * 서명이 바뀌고, 그 함수를 부르는 곳은 승인 창구 하나뿐이라 얻는 것이 없다.
 * 대신 `capabilities-gate.test.ts` 가 **approveQuote 를 부르는 자리 전부**에 이 관문이
 * 같이 있는지 센다 — 이름만 import 하고 안 부르는 판을 잡기 위해서다.
 */
export function requireQuoteApprove(viewer: Viewer | null | undefined): void {
  if (hasCapability(viewer, 'quote.approve')) return
  throw new CrmError('FORBIDDEN', '견적을 승인할 권한이 없습니다. 관리자에게 문의해 주세요.')
}

/**
 * **남의** 담당을 바꿀 수 있는가
 *
 * 본인 담당을 남에게 넘기는 길에는 이 관문을 두지 않는다 — 휴가와 인수인계는 막을 이유가 없고,
 * 승인을 받게 하면 아무도 안 넘기고 그냥 방치한다. 그 판정(담당자 본인인가)은 담당자 값을
 * 아는 자리에서 하고, 여기는 **권한만** 본다.
 *
 * 이 관문을 지나도 끝이 아니다. 권한 범위(조직도에서 계산한다)가 한 번 더 좁힌다 —
 * 팀장은 자기 부서 안에서만 재배정한다. 두 판정을 한 함수에 합치지 않는 이유는,
 * 합치면 「권한이 없어서 막힌 것」과 「범위 밖이라 막힌 것」을 사용자에게 구분해 말할 수 없어서다.
 */
export function requireOwnerReassign(viewer: Viewer | null | undefined): void {
  if (hasCapability(viewer, 'owner.reassign')) return
  throw new CrmError('FORBIDDEN', '담당자를 바꿀 권한이 없습니다. 본인 담당은 직접 넘길 수 있습니다.')
}
