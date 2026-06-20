// 주간보고 지연 판정 SSOT — 순수함수(외부 의존 없음, node 테스트 가능).
//
// 판정룰(확정):
//   기준선 = 취합(confirmed_at, 최신) + 캘린더 2단계 백스톱(KST)
//     · 토요일 00:00(KST) = week_start + 5일  → 1차 지연선
//     · 월요일 00:00(KST) = week_start + 7일  → 최종 지연선(다음 주 시작)
//   상태:
//     · 정시(on_time)     : 최종작성이 취합 이전 AND 토 00:00 이전
//     · 지연(late)        : 토 00:00~월 00:00 사이 최종작성, 또는 취합 이후 수정
//     · 최종지연(final_late): 다음 주 월 00:00 이후 작성·수정
//     · 미제출(missing)   : 한 번도 안 씀 + 월 00:00 경과
//     · 진행중(in_progress): 토 00:00 전 + 취합 전 (판정 보류)
//   재취합: confirmed_at은 최신값을 쓰되 캘린더선은 고정 → 재취합으로 지연 우회 불가.

export type TimelinessStatus = 'on_time' | 'late' | 'final_late' | 'missing' | 'in_progress'

const KST_OFFSET = '+09:00'

export interface WeekDeadlines {
  /** 토요일 00:00 KST (ISO UTC) — 1차 지연선 */
  satDue: string
  /** 다음 주 월요일 00:00 KST (ISO UTC) — 최종 지연선 */
  monDue: string
}

/** 'YYYY-MM-DD' 에 days 더한 'YYYY-MM-DD' (UTC 고정, 타임존 drift 없음). */
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** week_start(월요일) → KST 기준 토/월 마감선(UTC ISO). */
export function weekDeadlines(weekStart: string): WeekDeadlines {
  return {
    satDue: new Date(`${addDays(weekStart, 5)}T00:00:00${KST_OFFSET}`).toISOString(),
    monDue: new Date(`${addDays(weekStart, 7)}T00:00:00${KST_OFFSET}`).toISOString(),
  }
}

/** 멤버 1명의 주간보고 적시성(서버 집계 결과). 클라이언트 표시에도 사용 — 순수 타입. */
export interface MemberTimeliness {
  userId: string
  name: string
  status: TimelinessStatus
  delayMinutes: number
  firstAt: string | null
  lastAt: string | null
  confirmedAt: string | null
}

export interface JudgeInput {
  /** 최초 작성(create) 시각 ISO, 없으면 null */
  firstAt: string | null
  /** 최종 의미있는 작성/수정 시각 ISO, 없으면(미작성) null */
  lastAt: string | null
  /** 해당 부서·주차 취합 확정 시각 ISO(최신), 미취합이면 null */
  confirmedAt: string | null
  /** 주차 week_start 'YYYY-MM-DD'(월요일) */
  weekStart: string
  /** 현재 시각 ISO (미작성의 진행중/미제출 구분용) */
  now: string
}

export interface TimelinessResult {
  status: TimelinessStatus
  /** 지연 분(정시/진행중=0). 위반한 가장 이른 기준선 대비 최종작성 지연. */
  delayMinutes: number
}

const ms = (iso: string) => new Date(iso).getTime()

export function judgeTimeliness(input: JudgeInput): TimelinessResult {
  // firstAt은 판정에 쓰지 않음(상태는 최종작성 기준). 표시/증빙(툴팁·CSV "최초작성")용으로 입력에 유지.
  const { firstAt: _firstAt, lastAt, confirmedAt, weekStart, now } = input
  const { satDue, monDue } = weekDeadlines(weekStart)
  const satT = ms(satDue)
  const monT = ms(monDue)
  const nowT = ms(now)
  const confT = confirmedAt ? ms(confirmedAt) : null
  const lastT = lastAt ? ms(lastAt) : null

  // 미작성: 시간 경과(또는 취합 완료)로 진행중 → 지연 → 미제출
  if (lastT == null) {
    if (nowT >= monT) return { status: 'missing', delayMinutes: 0 }
    if (nowT >= satT) return { status: 'late', delayMinutes: 0 }
    // 취합이 이미 끝났는데 아직 미작성 → 지연(취합 시점 이후 = 지연 룰)
    if (confT != null && nowT >= confT) return { status: 'late', delayMinutes: 0 }
    return { status: 'in_progress', delayMinutes: 0 }
  }

  // 작성됨: 충족했어야 할 가장 이른 기준선 = min(토요일선, 취합선)
  const line = confT != null ? Math.min(satT, confT) : satT
  const delay = (ref: number) => Math.max(0, Math.round((lastT - ref) / 60000))

  if (lastT >= monT) return { status: 'final_late', delayMinutes: delay(line) }
  if (lastT >= satT || (confT != null && lastT > confT)) {
    return { status: 'late', delayMinutes: delay(line) }
  }
  return { status: 'on_time', delayMinutes: 0 }
}

/** 시각 ISO → KST 'MM/DD HH:mm' 표시(SSOT — 뷰 인라인 포맷 금지). null이면 '-'. */
export function formatKst(iso: string | null): string {
  if (!iso) return '-'
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`
}

/** 지연 분 → 사람이 읽는 표현(예: '2일 3시간', '1일 1분', '15분'). 0 이하는 '-'. */
export function formatDelay(minutes: number): string {
  if (minutes <= 0) return '-'
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  const parts: string[] = []
  if (d > 0) parts.push(`${d}일`)
  if (h > 0) parts.push(`${h}시간`)
  if (m > 0) parts.push(`${m}분`)
  return parts.join(' ')
}

/** 활동로그 1건(표시·집계 공용 순수 타입) */
export interface ActivityEntry { occurredAt: string; action: 'create' | 'edit' | 'delete' }
export interface ActivitySummary { firstAt: string | null; lastAt: string | null }

/**
 * 활동로그 → 최초/최종 "작성"(create/edit) 시각. 순수함수(테스트 가능).
 * delete는 이전 내용을 모두 지움 → 가장 최근 delete 이후의 작성만 집계한다.
 *   · 최신 action이 delete면 이후 작성 없음 → firstAt/lastAt 모두 null
 *     (전체 삭제 후 미작성이 "작성됨(지연)"으로 오판정되는 회귀 방지 — DC-REV H1).
 *   · delete 후 재작성하면 그 재작성분만으로 first/last 재집계.
 */
export function summarizeActivity(entries: ActivityEntry[]): ActivitySummary {
  let lastDelete: string | null = null
  for (const e of entries) {
    if (e.action === 'delete' && (!lastDelete || e.occurredAt > lastDelete)) {
      lastDelete = e.occurredAt
    }
  }
  let first: string | null = null
  let lastWrite: string | null = null
  for (const e of entries) {
    if (e.action === 'delete') continue
    // 가장 최근 delete 이전(또는 동시각)의 작성은 지워진 것으로 간주
    if (lastDelete && e.occurredAt <= lastDelete) continue
    if (!first || e.occurredAt < first) first = e.occurredAt
    if (!lastWrite || e.occurredAt > lastWrite) lastWrite = e.occurredAt
  }
  return { firstAt: first, lastAt: lastWrite }
}
