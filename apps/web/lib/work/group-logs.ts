// 업무 그룹핑 순수 집계 — 일일 로그를 엔티티(고객/딜) 기준으로 묶어 건수·상태·미리보기 산출. (단위테스트 대상)
import type { DailyLogEntryType } from '@/types/database'

export interface GroupLogInput {
  id: string
  content: string
  entry_type: DailyLogEntryType
  entityId: string | null   // 그룹 키(linked_account_id 또는 work_entity_links.entity_id). null=미링크
}

export interface WorkGroup {
  id: string
  count: number
  statusCounts: Record<DailyLogEntryType, number>
  recent: { id: string; content: string; entry_type: DailyLogEntryType }[]
}

export interface GroupResult { groups: WorkGroup[]; ungrouped: number }

const ZERO = (): Record<DailyLogEntryType, number> => ({ done: 0, doing: 0, planned: 0, blocker: 0, note: 0 })

/** entityId 기준 그룹핑. null은 ungrouped 카운트. 그룹은 count 내림차순, recent는 최대 5. */
export function groupLogsByEntity(logs: GroupLogInput[], recentMax = 5): GroupResult {
  const map = new Map<string, WorkGroup>()
  let ungrouped = 0
  for (const l of logs) {
    if (!l.entityId) { ungrouped++; continue }
    let g = map.get(l.entityId)
    if (!g) { g = { id: l.entityId, count: 0, statusCounts: ZERO(), recent: [] }; map.set(l.entityId, g) }
    g.count++
    g.statusCounts[l.entry_type]++
    if (g.recent.length < recentMax) g.recent.push({ id: l.id, content: l.content, entry_type: l.entry_type })
  }
  const groups = Array.from(map.values()).sort((a, b) => b.count - a.count)
  return { groups, ungrouped }
}

/** 관여 분포(대시보드용) — 그룹별 비중 Top N + 나머지 '기타'. */
export function engagementDistribution(groups: WorkGroup[], topN = 5): { id: string; count: number }[] {
  const sorted = [...groups].sort((a, b) => b.count - a.count)
  const top = sorted.slice(0, topN).map((g) => ({ id: g.id, count: g.count }))
  const restCount = sorted.slice(topN).reduce((s, g) => s + g.count, 0)
  if (restCount > 0) top.push({ id: '__etc__', count: restCount })
  return top
}
