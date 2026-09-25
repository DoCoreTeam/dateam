/**
 * 날짜 구간 — 순수 함수
 *
 * `seed.ts` 에서 뗐다. 저쪽은 `server-only` 라 시험이 import 할 수 없는데,
 * 달을 넘어가는 구간과 뒤집힌 구간은 틀리기 쉬운 자리다.
 */

import { addKstDays } from '../../datetime/kst.ts'

/** 시작일부터 종료일까지(양끝 포함)의 `YYYY-MM-DD` 목록 */
export function dateRange(fromDate: string, toDate: string): string[] {
  const days: string[] = []
  let cursor = fromDate
  // 한 해치를 넘겨 부르는 일은 없다. 상한을 둬 실수로 무한 루프가 되지 않게 한다
  for (let i = 0; i < 800 && cursor <= toDate; i += 1) {
    days.push(cursor)
    cursor = addKstDays(cursor, 1)
  }
  return days
}
