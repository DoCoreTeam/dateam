/**
 * 부여 위에 한 겹 더 서는 문 — **숨기기만 한다**
 *
 * ## 왜 한 겹이 더 필요한가
 *
 * 표면 판정(`decide.ts`)은 **관리자를 맨 먼저 통과시킨다.** 그것이 그 판정의 옳은 규칙이다 —
 * 관리자를 잠그면 열어 줄 사람이 사라진다. 그런데 표면 중에는 축이 다른 것이 있다.
 * AI 트레이딩에 든 것은 한 사람의 돈이 걸린 매매 판단 기록이고, 명세 M11 은 **소유자만**
 * 본다고 적는다. 관리자라는 이유로 남의 매매 기록이 열리면 안 된다.
 *
 * 두 규칙을 한 함수에 섞으면 둘 다 틀린다. 그래서 덧댄다.
 *
 * ## 이 판정은 **막지 않는다**
 *
 * 여기는 **메뉴에서 지우는 자리**다. 진짜 막는 것은 그 화면의 레이아웃
 * (`app/(member)/trading/layout.tsx`)이고, 그 확인은 이 판정이 생겨도 그대로 남는다.
 * 주소는 손으로 칠 수 있으므로 숨기기로 막기를 대신할 수 없다.
 *
 * 그럼 왜 숨기나: 안 숨기면 **죽은 문**이 생긴다. 소유자가 아닌 관리자의 사이드바에
 * 「AI 트레이딩」이 서고, 누르면 「소유자 한 사람만 볼 수 있습니다」가 뜬다.
 * 누를 수 있는데 못 들어가는 줄은 사용자에게 「내 권한이 잘못됐다」로 읽힌다.
 *
 * ## 답은 문과 같은 함수에서 나온다
 *
 * 숨기는 쪽이 자기만의 조건을 적으면 문과 갈린다. 그래서 여기서도
 * `decideTradingAccess` 를 부른다 — 메뉴와 문이 **같은 함수에게 묻는다.**
 */

import { decideTradingAccess } from '../trading/access-decide.ts'

/**
 * 추가 문이 걸린 표면과 **왜 걸렸는지**.
 *
 * 사유를 적게 하는 것이 이 표의 전부다. 적지 않으면 다음 사람이
 * 「관리자가 못 들어가네」를 고장으로 보고 지운다.
 */
export const EXTRA_GATED: Readonly<Record<string, string>> = {
  trading:
    'AI 트레이딩은 소유자 한 사람만 본다(명세 M11). 표면 판정은 관리자를 먼저 통과시키므로 그대로 두면 모든 관리자의 메뉴에 서고, 눌러도 못 들어간다',
}

export function hasExtraGate(surfaceKey: string): boolean {
  return Object.prototype.hasOwnProperty.call(EXTRA_GATED, surfaceKey)
}

export interface ExtraGateViewer {
  userId: string | null
  isAdmin: boolean
}

/** 추가 문이 판정에 쓰는 값. 부르는 쪽이 요청당 한 번 모아 넘긴다 */
export interface ExtraGateContext {
  /** `trading_settings` 의 `owner_user_id`. 비어 있으면 아직 아무도 아니다 */
  tradingOwnerUserId: string | null
}

/**
 * 표면 판정을 통과한 뒤 한 번 더 묻는다.
 *
 * @returns 메뉴에 그려도 되나
 */
export function passesExtraGate(
  surfaceKey: string,
  viewer: ExtraGateViewer,
  context: ExtraGateContext,
): boolean {
  if (surfaceKey === 'trading') {
    return decideTradingAccess(viewer, context.tradingOwnerUserId).allowed
  }

  /**
   * 목록에만 올리고 규칙을 안 붙이면 **그 표면은 열린 채로 남는다.**
   * 그래서 모르는 키는 닫는다 — 위에 한 줄을 더하면 여기에도 한 줄이 서야 한다.
   * 걸리지 않은 표면은 그대로 통과시킨다(이 함수는 새 문을 만들지 않는다).
   */
  return !hasExtraGate(surfaceKey)
}
