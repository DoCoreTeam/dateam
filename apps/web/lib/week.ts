// 주차(week_start = 월요일 date 문자열 'YYYY-MM-DD') 순수 유틸. 외부 의존 없음 — node 테스트 가능.

/** week_start(월요일) → 7일 전 월요일 'YYYY-MM-DD'. UTC 고정으로 타임존 drift 없음. */
export function prevWeekStart(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 7)
  return d.toISOString().slice(0, 10)
}
