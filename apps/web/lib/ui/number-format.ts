/**
 * 화면에 뜨는 숫자 — **한 자리에서 굽는다**
 *
 * ## 왜 생겼나
 *
 * 사용자 지적(2026-09-30): *"모든 숫자에 콤마찍는건 기본 아닌가"*
 *
 * AI 트레이딩 현황이 지금 가격을 「1086.44」로 그리고 있었다. 자릿수를 세어야 천인지
 * 만인지 알 수 있고, 값이 빠르게 바뀌는 화면에서 세는 일은 사람이 못 한다.
 * 원인은 각자 굽기였다 — 가격 포맷터가 **둘**(`formatIndexPrice`·`priceText`)인데
 * 둘 다 `toFixed(2)` 한 줄이었고, 쉼표를 다는 자리(금액 입력칸·GPU 가격표)와
 * 안 다는 자리(트레이딩)가 갈려 있었다.
 *
 * ## 왜 `toLocaleString` 이 아닌가
 *
 * 쓸 수는 있지만 **자릿수를 고정하려면 옵션 두 개를 매번 같이 적어야 한다**
 * (`minimumFractionDigits`·`maximumFractionDigits`). 한쪽만 적은 자리가 생기면
 * 표에서 자리가 흔들리고, 그것이 애초에 트레이딩이 `toFixed` 를 쓴 이유였다.
 * 그리고 자릿수 묶기는 이 저장소에 **이미 있다**(`money-format.ts` 의 `groupDigits`) —
 * 두 벌로 두면 언젠가 한쪽만 고쳐진다.
 *
 * ## 안 하는 것
 *
 * **없는 값을 0 으로 만들지 않는다.** 무엇을 대신 보여 줄지는 부르는 쪽이 안다 —
 * 트레이딩은 「값 없음」이고 표는 「-」다. 여기서 고르면 한 문구가 모든 화면에 샌다.
 */

import { groupDigits } from './money-format.ts'

/**
 * 숫자 하나를 사람이 읽는 모양으로.
 *
 * @param value  숫자. `null`·`undefined`·`NaN`·`Infinity` 면 `null` 을 돌려준다
 * @param digits 소수 자릿수. 표에서 자리가 안 흔들리게 **고정**한다 (기본 0)
 *
 * @example fmtNum(1086.44, 2) // '1,086.44'
 * @example fmtNum(-1086.44, 2) // '-1,086.44'
 * @example fmtNum(null, 2) // null — 부르는 쪽이 문구를 정한다
 */
export function fmtNum(value: number | null | undefined, digits = 0): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  // 음수는 부호를 떼고 묶는다 — 붙인 채로 묶으면 「-1,086」의 앞자리가 네 자리로 세어진다
  const sign = value < 0 ? '-' : ''
  const fixed = Math.abs(value).toFixed(digits)
  return `${sign}${groupDigits(fixed)}`
}

/**
 * 없을 때 무엇을 보여 줄지까지 한 번에. 부르는 쪽이 문구를 준다.
 *
 * @example fmtNumOr(null, '값 없음', 2) // '값 없음'
 */
export function fmtNumOr(value: number | null | undefined, fallback: string, digits = 0): string {
  return fmtNum(value, digits) ?? fallback
}
