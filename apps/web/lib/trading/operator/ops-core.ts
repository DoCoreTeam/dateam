/**
 * 운영자 점검 값의 셈 규칙 — **순수하게**
 */

/**
 * 그 구간에 있어야 할 1분 봉 수.
 *
 * 접속매매 시작(포함)부터 종료(제외)까지의 분 수다. 종료를 포함하면 하루에 봉이
 * 하나 더 있는 것이 되고, 점검은 멀쩡한 날마다 「한 줄 결측」이라고 말한다.
 *
 * 구간을 모르거나 뒤집혀 있으면 `null` — 0 이 아니다.
 * 0 은 「봉이 없어야 한다」는 강한 말이고, 그러면 실제로 없어도 정상이 된다.
 */
export function expectedBarCount(start: Date, end: Date): number | null {
  const from = start.getTime()
  const until = end.getTime()
  if (!Number.isFinite(from) || !Number.isFinite(until)) return null
  if (until <= from) return null
  return Math.floor((until - from) / 60_000)
}
