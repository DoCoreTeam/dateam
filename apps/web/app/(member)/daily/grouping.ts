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

/**
 * 한 origin 그룹을 표시용으로 분리한다 (표시 로직 SSOT).
 * - rawHead: 즉시저장 원문 행(ai_processed=false & source_type='manual') — 헤더 전용
 * - childLogs: 화면 카드로 보일 분해 자식
 * - headLog: 헤더/수정·삭제 기준 행(rawHead 우선, 없으면 첫 항목)
 * 구(舊) 데이터(원문 행 없이 ai_split만 있는 그룹)는 rawHead=null → 전체를 자식으로 표시(기존 동작 호환).
 */
export interface OriginGroupView {
  rawHead: DailyLog | null
  childLogs: DailyLog[]
  headLog: DailyLog
}

// raw 헤드 판별/제외는 lib/daily/raw-head.ts(SSOT). 기존 import 경로 호환을 위해 재export.
export { isRawHead, excludeRawHeads, EXCLUDE_RAW_HEAD_OR } from '../../../lib/daily/raw-head.ts'

export function splitOriginGroup(logs: DailyLog[]): OriginGroupView {
  const rawHead = logs.find((l) => l.ai_processed === false && l.source_type === 'manual') ?? null
  const headLog = rawHead ?? logs[0]
  const childLogs = rawHead ? logs.filter((l) => l.id !== rawHead.id) : logs
  return { rawHead, childLogs, headLog }
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
