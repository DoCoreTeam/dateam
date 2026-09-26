/**
 * 이 값을 **설정 화면에서** 바꿔도 되나 — 순수 판정
 *
 * ## 왜 필요한가
 *
 * 설정 화면은 레지스트리 88개를 한 줄씩 그린다. 그런데 그중 몇은 **그냥 쓰면 안 되는 값**이다.
 *
 * - `notify_enabled` 는 검증 관문과 섀도 일수를 지나야 켜진다(`decideEnableNotify`).
 *   설정 화면에서 참으로 써 버리면 **관문을 지나가는 길이 하나 생긴다.** 관문은 그대로 있는데
 *   옆문이 열린 것이고, 그건 관문이 없는 것과 같다.
 * - `night_signal_enabled` 도 같은 모양이다(`decideToggleNight`).
 * - `owner_user_id` 는 접근권한 화면이 정한다. 두 곳에서 쓰면 두 벌이 되고,
 *   그 값은 **문**이라 두 벌이 되는 순간 누가 들어오는지를 두 화면이 다르게 말한다.
 *
 * ## 왜 숨기지 않고 말하나
 *
 * 목록에서 빼면 관리자는 그 값이 **없는 줄** 안다. 그리고 왜 없는지 물을 데가 없다.
 * 그래서 줄은 그대로 두고 「여기서는 못 바꾼다, 저기서 바꾼다」를 적는다.
 *
 * ## 왜 순수 함수인가
 *
 * 관문을 우회하는 길이 생겼는지는 **시험할 수 있어야** 한다. DB 가 붙어 있으면
 * 「관문이 안 선 상태에서 설정으로 켜기」 같은 조합을 못 만들고, 못 만드는 조합은 안 시험한다.
 */

/** 이 화면에서 못 바꾸는 값과, **어디서 바꾸는가** */
export const CHANGED_ELSEWHERE: Readonly<Record<string, string>> = {
  owner_user_id: '접근권한 화면에서 정합니다',
  notify_enabled: '검증 관문을 지나야 켤 수 있어 현황 화면의 알림 칸에서 켭니다',
  night_signal_enabled: '야간 규칙 확인을 지나야 해서 운영 화면에서 켭니다',
}

/** 설정 화면에서 바로 저장해도 되는 값인가 */
export function editableHere(key: string): boolean {
  return !Object.prototype.hasOwnProperty.call(CHANGED_ELSEWHERE, key)
}

/** 못 바꾸는 값이면 어디서 바꾸는지, 바꿔도 되면 null */
export function whyElsewhere(key: string): string | null {
  return CHANGED_ELSEWHERE[key] ?? null
}
