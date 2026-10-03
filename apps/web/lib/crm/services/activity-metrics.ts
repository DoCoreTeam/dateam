/**
 * 활동 지표 — **활동을 세는 엔진** (P0105 I06)
 *
 * 왜 따로 있나 (실측 2026-10-02): 리포트 지표 14개가 전부 딜 기준이었고 `crm_activity`
 * 421건은 리포트에 한 번도 안 섰다. 그래서 「이번 달 누가 몇 번 접촉했나」에 답할 자리가
 * 없었다. 딜 엔진(`domain/metric-agg.ts`)에 억지로 넣지 않는 이유는 활동에 **금액·단계·
 * 성사확률이 없다**는 것이고, 없는 칸을 선언에 남기면 코드가 그 사실을 말하지 못한다.
 *
 * 돌려주는 모양은 딜 엔진과 **같다**(`AggResult`). 화면이 카드와 교차표를 그리는 코드를
 * 두 벌 들 이유가 없다. 세는 대상이 다른 것과 그리는 법이 다른 것은 다른 문제다.
 *
 * **시간은 KST 로 자른다.** 활동 서비스가 정렬에 쓰는 규약과 같다(일어난 시각 기준).
 */

import type { CrmDb } from '../db/client.ts'
import { periodRange, type Period } from '../domain/target.ts'
import { metricOf } from '../domain/metrics.ts'
/*
  **칸 이름 규약을 다시 짜지 않는다.** `ALL_KEY`·`CELL_SEP` 은 화면이 칸을 찾는 열쇠이고
  엔진이 정한 값이다. 여기서 제 값을 지어 썼더니 교차표가 **한 칸도 안 채워졌다**
  (실측 2026-10-04 실브라우저: 줄 이름은 뜨는데 값이 전부 「—」였다. 단위 시험은 내가
  지은 열쇠로 찾아서 통과했다 — 시험이 구현을 따라가면 이런 것을 못 잡는다).
*/
import {
  timeBucketOf, isTimeAxis, ALL_KEY, CELL_SEP,
  type AggResult, type AggAxisItem, type Cell, type TimeGrain,
} from '../domain/metric-agg.ts'
import { FILTER_ALL } from '../../terms/action.ts'
import { kstDateKey } from '../../datetime/kst.ts'
import {
  ACTIVITY_AXIS, ACTIVITY_TYPE_LABEL, ACTIVITY_HUMAN_TYPES, type ActivityTypeKey,
} from '../../terms/activity.ts'
import { DIMENSION_EMPTY } from '../../terms/report.ts'

/** 쪼갤 수 있는 축 둘. 딜의 축 목록과 섞지 않는다 — 활동에 단계도 사업 유형도 없다 */
export const ACTIVITY_AXES = [
  { key: 'activityType', label: ACTIVITY_AXIS.type },
  { key: 'activityAuthor', label: ACTIVITY_AXIS.author },
] as const

export type ActivityAxisKey = 'activityType' | 'activityAuthor'

export function isActivityAxis(key: string | null | undefined): key is ActivityAxisKey {
  return key === 'activityType' || key === 'activityAuthor'
}

/** 세는 데 필요한 것만 읽는다. 본문은 안 읽는다 — 그건 목록 화면의 일이다 */
export interface MetricActivity {
  id: string
  type: string
  occurredAt: Date
  createdById: string | null
}

export interface LoadedActivities {
  items: MetricActivity[]
  /** 상한에 걸렸나. 조용히 자르면 화면이 「이게 전부」로 읽는다 */
  truncated: boolean
  /** id 에서 이름으로. 축에 사람 id 가 찍히면 안 된다 */
  memberNames: Map<string, string>
}

/**
 * 셈에 쓸 상한.
 *
 * 왜 상한이 있나: 활동은 가장 빨리 쌓이는 표다(노트 하나하나가 한 줄이다). 전부 읽어
 * 메모리에서 세는 방식은 몇 만 건에서 무너진다. 지금은 421건이라 넉넉하지만
 * **넘으면 넘었다고 말한다** — 그것이 조용히 자르는 것과 다른 점이다.
 */
export const ACTIVITY_SCAN_CAP = 20000

export async function loadActivitiesForMetrics(db: CrmDb): Promise<LoadedActivities> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmActivity.findMany({
    select: { id: true, type: true, occurredAt: true, createdById: true },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: ACTIVITY_SCAN_CAP + 1,
  }) as MetricActivity[]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const members = await (db as any).crmMember.findMany({
    select: { id: true, displayName: true },
  }) as { id: string; displayName: string }[]

  return {
    items: rows.length > ACTIVITY_SCAN_CAP ? rows.slice(0, ACTIVITY_SCAN_CAP) : rows,
    truncated: rows.length > ACTIVITY_SCAN_CAP,
    memberNames: new Map(members.map((m) => [m.id, m.displayName])),
  }
}

export interface ActivityQuerySpec {
  metric: string
  period: Period
  /** 행축·열축. 시간 축(월·분기·반기·연)과 활동 축 둘을 받는다 */
  rows?: string | null
  cols?: string | null
}

/**
 * 사람이 남긴 것인가.
 *
 * **목록 화면과 같은 목록을 쓴다**(`ACTIVITY_HUMAN_TYPES`). 두 곳에 따로 적으면
 * 카드가 398 인데 그 카드에서 열린 목록이 421 을 보여 준다.
 */
const HUMAN: ReadonlySet<string> = new Set<string>(ACTIVITY_HUMAN_TYPES)

function isHuman(type: string): boolean {
  return HUMAN.has(type)
}

function bucketOf(a: MetricActivity, axis: string, names: Map<string, string>): AggAxisItem {
  if (axis === 'activityType') {
    return { key: a.type, label: ACTIVITY_TYPE_LABEL[a.type as ActivityTypeKey] ?? a.type }
  }
  // 남긴 사람. 사람을 모르는 기록(시스템이 만든 것)은 「없음」 한 줄로 모은다
  if (!a.createdById) return { key: '', label: DIMENSION_EMPTY }
  return { key: a.createdById, label: names.get(a.createdById) ?? DIMENSION_EMPTY }
}

function emptyCell(): Cell { return { count: 0, byCurrency: {} } }

/**
 * 일어난 날(KST 날짜키).
 *
 * `occurredAt` 은 DB 에서 오면 `Date` 이고 JSON 을 거치면 문자열이다. 둘 다 받는다 —
 * 한쪽만 받으면 시험(문자열)과 운영(Date) 중 하나가 조용히 틀린다.
 */
function dayOf(a: MetricActivity): string {
  const at = a.occurredAt
  return kstDateKey(at instanceof Date ? at.toISOString() : String(at))
}

/**
 * 활동을 센다.
 *
 * 돌려주는 모양이 딜 엔진과 같으므로 화면은 어느 엔진이 센 것인지 몰라도 그린다.
 * 금액 칸(`byCurrency`)은 늘 비어 있다 — 활동에 금액이 없다. 0 원이라고 적지 않는다.
 */
export function runActivityMetric(loaded: LoadedActivities, spec: ActivityQuerySpec): AggResult {
  const decl = metricOf(spec.metric)
  if (!decl) throw new Error(`모르는 지표입니다: ${spec.metric}`)

  const { from, to } = periodRange(spec.period)
  const rowsAxis = spec.rows ?? null
  const colsAxis = spec.cols ?? null

  const rowItems = new Map<string, AggAxisItem>()
  const colItems = new Map<string, AggAxisItem>()
  const cells = new Map<string, Cell>()
  const total = emptyCell()

  const axisOf = (a: MetricActivity, axis: string | null): AggAxisItem => {
    // 축을 안 골랐으면 한 칸이다. 이름도 딜 엔진과 같은 말을 쓴다
    if (!axis) return { key: ALL_KEY, label: FILTER_ALL }
    if (isTimeAxis(axis)) return timeBucketOf(dayOf(a), axis.toUpperCase() as TimeGrain)
    return bucketOf(a, axis, loaded.memberNames)
  }

  let matched = 0
  for (const a of loaded.items) {
    // 기간은 **일어난 날**로 자른다. 적은 날로 자르면 지난주 통화가 이번 주로 센다
    const day = dayOf(a)
    if (day < from || day > to) continue
    if (decl.humanOnly && !isHuman(a.type)) continue
    matched += 1

    const r = axisOf(a, rowsAxis)
    const c = axisOf(a, colsAxis)
    if (!rowItems.has(r.key)) rowItems.set(r.key, r)
    if (!colItems.has(c.key)) colItems.set(c.key, c)

    const cellKey = `${r.key}${CELL_SEP}${c.key}`
    const cell = cells.get(cellKey) ?? emptyCell()
    cell.count += 1
    cells.set(cellKey, cell)
    total.count += 1
  }

  return {
    metric: decl.key,
    label: decl.label,
    unit: decl.unit,
    dateBasis: decl.dateBasis,
    from,
    to,
    rows: sortAxis([...rowItems.values()], rowsAxis),
    cols: sortAxis([...colItems.values()], colsAxis),
    cells: Object.fromEntries(cells),
    total,
    notes: {
      // 활동에는 성사확률이 없다. 「확률을 모르는 딜」 안내가 뜰 자리가 아니다
      unknownProbability: 0,
      // 금액이 없으므로 통화가 섞일 일도 없다
      mixedCurrency: false,
      matched,
    },
  }
}

/**
 * 축 줄 순서.
 *
 * 시간 축은 **시간순**이고(키가 `2026Q3` 꼴이라 글자순이 곧 시간순이다) 나머지는
 * 많은 것부터가 아니라 **이름순**이다. 사람 이름을 건수로 줄 세우면 그 표가 사람을
 * 견주는 표로 읽힌다 — 그건 이 지표가 답하려는 질문이 아니다.
 */
function sortAxis(items: AggAxisItem[], axis: string | null): AggAxisItem[] {
  if (!axis) return items
  if (isTimeAxis(axis)) return items.sort((a, b) => a.key.localeCompare(b.key))
  return items.sort((a, b) => a.label.localeCompare(b.label, 'ko-KR'))
}
