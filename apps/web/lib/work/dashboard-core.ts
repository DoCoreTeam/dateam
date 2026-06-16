// 워크로드 대시보드 순수 집계 — 주별 활동 추세 + 상태 롤업. (단위테스트 대상, Date 사용은 입력 문자열 기반)
import type { DailyLogEntryType } from '@/types/database'

/** YYYY-MM-DD → 그 주 월요일(YYYY-MM-DD). 시간대 영향 없도록 UTC 정오 기준. */
export function weekStartOf(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const dow = (d.getUTCDay() + 6) % 7 // 월=0
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

/** 최근 N주 활동 추세 — todayStr 포함 주부터 역순 N주, 각 주 count. 오래된→최신 순 반환. */
export function weeklyTrend(dates: string[], todayStr: string, weeks = 8): { weekStart: string; count: number }[] {
  const cur = weekStartOf(todayStr)
  const buckets: string[] = []
  const base = new Date(cur + 'T12:00:00Z')
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(base); d.setUTCDate(d.getUTCDate() - i * 7)
    buckets.push(d.toISOString().slice(0, 10))
  }
  const idx = new Map(buckets.map((w, i) => [w, i]))
  const counts = new Array(weeks).fill(0)
  for (const ds of dates) {
    const w = weekStartOf(ds)
    const i = idx.get(w)
    if (i !== undefined) counts[i]++
  }
  return buckets.map((w, i) => ({ weekStart: w, count: counts[i] }))
}

/** 상태 롤업 — entry_type 총계. */
export function statusRollup(types: DailyLogEntryType[]): Record<DailyLogEntryType, number> {
  const r: Record<DailyLogEntryType, number> = { done: 0, doing: 0, planned: 0, blocker: 0, note: 0 }
  for (const t of types) if (t in r) r[t]++
  return r
}
