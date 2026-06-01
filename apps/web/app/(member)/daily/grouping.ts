import type { DailyLog } from '@/types/database'

/**
 * 한 번에 입력된 묶음(메인-서브) 표시를 위한 클라이언트 그룹.
 * DB/백엔드 변경 없이 logs[] → groups[] 로만 변환한다.
 */
export interface LogGroup {
  /** 그룹 식별 키 (origin_group_id 또는 single:<id>) */
  key: string
  /** 그룹에 속한 로그들 (입력 순서 = logged_at ASC 보존) */
  logs: DailyLog[]
  /** 같은 입력에서 분리된 2건 이상의 배치인지 — true면 묶음 헤더로 표시 */
  isBatch: boolean
  /** 묶음 헤더 라벨 (대표 = 첫 항목 content 말줄임) */
  label: string
  /** 그룹 내 가장 이른 logged_at */
  loggedAt: string
  /** 화면에 로드된 항목 수 (화면 로드분 기준) */
  count: number
  /** 완료(done) 항목 수 */
  doneCount: number
}

const LABEL_MAX = 30

/** 여러 줄/공백을 한 줄로 정리하고 길면 말줄임표를 붙인다. */
export function truncateLabel(text: string, max: number = LABEL_MAX): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, max).trimEnd()}…`
}

/**
 * 일일업무 로그를 입력 묶음 단위로 그룹핑한다.
 * - origin_group_id 가 있으면 같은 배치끼리 묶음
 * - 없으면(수동/단건) 자기 자신만의 1건 그룹(single:<id>)
 * - 입력 배열의 first-seen 순서를 그대로 유지 (logged_at ASC 정렬 가정)
 */
export function groupDailyLogs(logs: DailyLog[]): LogGroup[] {
  const order: string[] = []
  const map = new Map<string, DailyLog[]>()

  for (const log of logs) {
    const key = log.origin_group_id ?? `single:${log.id}`
    const bucket = map.get(key)
    if (bucket) {
      bucket.push(log)
    } else {
      map.set(key, [log])
      order.push(key)
    }
  }

  return order.map((key) => {
    const groupLogs = map.get(key) as DailyLog[]
    const count = groupLogs.length
    const loggedAt = groupLogs.reduce(
      (min, l) => (l.logged_at < min ? l.logged_at : min),
      groupLogs[0].logged_at,
    )
    const doneCount = groupLogs.filter((l) => l.entry_type === 'done').length
    return {
      key,
      logs: groupLogs,
      isBatch: count > 1,
      label: truncateLabel(groupLogs[0].content),
      loggedAt,
      count,
      doneCount,
    }
  })
}
