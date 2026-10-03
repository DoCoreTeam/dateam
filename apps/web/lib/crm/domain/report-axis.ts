/**
 * 리포트의 축 (SSOT) — 관점·기간·대상
 *
 * **왜 축부터 정하나**: 지금 리포트는 「파이프라인 합계와 성사율」 하나뿐이다.
 * 그런데 같은 딜을 보는 눈이 **셋**이고, 셋이 서로 다른 숫자를 답한다 —
 * 그 셋을 구분하지 않으면 어떤 숫자를 봐도 「이게 무슨 뜻이지」가 남는다.
 * (사용자 지적: 「매출관점이든 회계 관점이든 영업관점이든 리포트가 명확해야 하고
 *  마감, 시점, 대상, 금액, 상세 이런 리포트에 담겨야 하는 항목이…」)
 *
 * 표준 용어를 그대로 쓴다 — 우리가 지어내면 회계·경영진과 말이 안 통한다.
 *   · Bookings(수주) / Revenue(인식 매출) / Billings·Cash(현금)
 *   · 한국 건설·용역 회계의 수주액 / 매출액(진행기준) / 기성고와 같은 갈래다
 */

/** 같은 딜을 보는 세 가지 눈 */
export type ReportLens = 'SALES' | 'REVENUE' | 'CASH'

export const LENS_LABEL: Record<ReportLens, string> = {
  SALES: '영업',
  REVENUE: '매출',
  CASH: '현금',
}

/** 각 눈이 답하는 **질문**. 이걸 화면에 적어야 사람이 숫자를 해석할 수 있다 */
export const LENS_QUESTION: Record<ReportLens, string> = {
  SALES: '얼마나 따냈나',
  REVENUE: '이 기간에 얼마가 매출로 잡히나',
  CASH: '얼마가 들어오나',
}

export const LENS_HINT: Record<ReportLens, string> = {
  SALES: '계약한 시점으로 셉니다. 5년 계약이면 계약한 달에 5년치가 통째로 잡힙니다. 「얼마짜리 일을 따냈나」의 답입니다.',
  REVENUE: '사업 기간에 나눠 셉니다. 5년 계약 5억이면 해마다 1억입니다. 회계가 보는 숫자입니다.',
  CASH: '현물을 뺀 금액으로 셉니다. 현물은 돈으로 들어오지 않습니다.',
}

/** 각 눈이 **어느 금액**을 보나 — 기획 「수주 매출과 현물」 단계 5 */
export const LENS_AMOUNT_LABEL: Record<ReportLens, string> = {
  SALES: '수주 총액',
  REVENUE: '인식 매출',
  CASH: '현금 매출',
}

export const LENS_ORDER: readonly ReportLens[] = ['SALES', 'REVENUE', 'CASH']

// ------------------------------------------------------------
// 기간
// ------------------------------------------------------------

/**
 * 달력 기간은 **`domain/target.ts` 가 센다.** 여기서 또 세지 않는다.
 *
 * 왜: 이 파일에 월·분기·연 경계 계산이 한 벌 더 있었다. 그래서 현황 탭은
 * 「이번 달·이번 분기·올해」 셋만 알고 **반기를 몰랐고**, 지표 탭은 연·반기·분기·월을
 * 아는데 둘이 서로 다른 말을 썼다. 같은 화면의 두 탭이 다른 기간 어휘를 쓰면
 * 「3분기 수주」를 두 탭에서 물었을 때 어느 쪽을 믿어야 하는지 알 길이 없다
 * (실측 2026-10-02: `PeriodKey` 넷과 `PeriodKind` 넷이 하나도 안 겹쳤다).
 */
import {
  periodRange as calendarRange,
  periodOfToday,
  parsePeriodKey,
  formatPeriodKey,
  periodLabel,
  periodIndexLabel,
  INDEX_MAX,
  PERIOD_KIND_LABEL,
  type Period,
  type PeriodKind,
} from './target.ts'
import { ROLLING_12M_LABEL, PERIOD_KIND_ORDER } from '../../terms/report.ts'

export { PERIOD_KIND_LABEL, PERIOD_KIND_ORDER, periodIndexLabel, INDEX_MAX, ROLLING_12M_LABEL, type Period, type PeriodKind }


/**
 * 달력에 없는 기간 하나: 「오늘부터 뒤로 12개월」.
 *
 * 달력 기간과 **다른 질문**이라 남긴다. 「올해」는 1월에 물으면 한 달치지만
 * 이것은 언제 물어도 열두 달치다. 추세를 볼 때 쓰는 자다.
 *
 * 주소에 싣는 값은 옛 이름 `LAST_12M` 그대로다. 이름은 바꿀 수 있지만
 * 이미 나간 링크는 바꿀 수 없다. 사람이 읽는 글자는 용어집이 든다.
 */
export const ROLLING_12M = 'LAST_12M'

/** 현황 탭이 보고 있는 기간. 달력 기간이거나 굴러가는 12개월이거나 */
export type ReportPeriod =
  | { rolling: true }
  | { rolling: false; period: Period }

/**
 * 옛 주소를 안 깨뜨린다. 북마크와 공유 링크가 살아 있다.
 *
 * 지우면 어제 보낸 링크가 오늘 다른 기간을 연다. 그건 조용한 거짓말이라
 * 깨진 링크보다 나쁘다.
 */
const LEGACY: Record<string, PeriodKind> = {
  THIS_YEAR: 'YEAR',
  THIS_QUARTER: 'QUARTER',
  THIS_MONTH: 'MONTH',
}

export interface PeriodRange {
  /** `YYYY-MM-DD` — KST 기준. 이 날 포함 */
  from: string
  /** `YYYY-MM-DD` — 이 날 포함 */
  to: string
  label: string
}

/**
 * 주소에서 기간을 읽는다. **못 읽으면 기본값이다. 500 을 주지 않는다.**
 *
 * 주소를 손으로 고친 사람에게 오류 화면을 주면 자기가 뭘 잘못했는지 영영 모른다.
 */
export function parseReportPeriod(raw: string | null | undefined, todayKey: string): ReportPeriod {
  const v = (raw ?? '').trim()
  if (!v) return { rolling: false, period: periodOfToday('YEAR', todayKey) }
  if (v === ROLLING_12M) return { rolling: true }
  const legacy = LEGACY[v]
  if (legacy) return { rolling: false, period: periodOfToday(legacy, todayKey) }
  const fallback = periodOfToday('YEAR', todayKey)
  const parsed = parsePeriodKey(v, fallback)
  return { rolling: false, period: parsed }
}

/** 주소에 싣는 값: `parseReportPeriod` 가 그대로 되읽는다 */
export function formatReportPeriod(p: ReportPeriod): string {
  return p.rolling ? ROLLING_12M : formatPeriodKey(p.period)
}

/**
 * 사람이 읽는 기간 이름: 「2026년 3분기」 「최근 12개월」.
 *
 * **글자를 여기서 만들지 않는다.** 목표 화면이 쓰는 `periodLabel` 을 그대로 부른다.
 * 예전에 이 자리에 모양이 한 벌 더 있어서, 지표 탭은 「2026 3분기」를 현황 탭은
 * 「2026년 3분기」를 적었다. 두 탭이 같은 기간 어휘를 쓴다는 것은 뜻이 같은 것이
 * 아니라 **글자가 같은 것**이다.
 */
export function reportPeriodLabel(p: ReportPeriod): string {
  return p.rolling ? ROLLING_12M_LABEL : periodLabel(p.period)
}

/**
 * 기간을 날짜 범위로.
 *
 * **오늘을 인자로 받는다.** 이 파일은 시간을 모른다 — 호출부가 KST 오늘을 넘긴다.
 * 그래야 테스트가 「12월 31일에 이번 분기가 어디까지인가」를 물을 수 있다.
 */
export function reportPeriodRange(p: ReportPeriod, todayKey: string): PeriodRange {
  if (!p.rolling) {
    const { from, to } = calendarRange(p.period)
    return { from, to, label: reportPeriodLabel(p) }
  }
  // 최근 12개월: 이번 달 포함 12개월
  const [y, m] = todayKey.split('-').map(Number)
  const pad = (n: number) => String(n).padStart(2, '0')
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate()
  const fromM = m - 11
  const fromY = fromM > 0 ? y : y - 1
  const realFromM = fromM > 0 ? fromM : fromM + 12
  return {
    from: `${fromY}-${pad(realFromM)}-01`,
    to: `${y}-${pad(m)}-${pad(lastDay(y, m))}`,
    label: ROLLING_12M_LABEL,
  }
}

/**
 * 한 칸 앞 또는 뒤 기간: **지난 기간을 보는 길**.
 *
 * 없었다. 현황 탭은 「이번 달·이번 분기·올해」만 알아서 **지난 분기를 볼 길이 아예 없었다**
 * (실측 2026-10-02). 분기 보고에서 가장 먼저 묻는 것이 지난 분기인데 답할 자리가 없었다.
 *
 * 굴러가는 12개월은 움직이지 않는다. 그 기간의 「앞」은 뜻이 없다.
 */
export function shiftReportPeriod(p: ReportPeriod, step: number): ReportPeriod {
  if (p.rolling) return p
  const { kind, year, index } = p.period
  if (kind === 'YEAR') return { rolling: false, period: { kind, year: year + step } }
  const max = INDEX_MAX[kind]
  // 0-based 로 옮기고 되돌린다. 1-based 로 더하면 경계에서 한 칸씩 어긋난다
  const flat = (year * max) + (index! - 1) + step
  return {
    rolling: false,
    period: { kind, year: Math.floor(flat / max), index: (flat % max) + 1 },
  }
}

// ------------------------------------------------------------
// 대상 — 무엇으로 쪼개 볼 것인가
// ------------------------------------------------------------

export type GroupKey = 'OWNER' | 'BUSINESS_TYPE' | 'PIPELINE' | 'COMPANY' | 'STAGE'

export const GROUP_LABEL: Record<GroupKey, string> = {
  OWNER: '담당자',
  BUSINESS_TYPE: '사업 유형',
  PIPELINE: '파이프라인',
  COMPANY: '회사',
  STAGE: '단계',
}

export const GROUP_ORDER: readonly GroupKey[] = ['STAGE', 'BUSINESS_TYPE', 'OWNER', 'COMPANY', 'PIPELINE']

// ------------------------------------------------------------
// 지표 — 이름과 뜻
// ------------------------------------------------------------

/*
  지표의 이름과 뜻은 **잎사귀 모듈**(`metric-labels.ts`)에 산다. 여기서 재수출한다.

  `metrics.ts` 가 그 둘을 이 파일에서 가져가면
  `report-axis → target → metrics → report-axis` 가 닫히고, 번들 초기화 순서가 뒤집혀
  `/api/crm/reports` 가 prerender 단계에서 죽는다 (실측 2026-10-03).
  쓰는 쪽은 바뀌지 않는다. 이 파일에서 계속 가져가면 된다.
*/
export { METRIC, METRIC_HINT } from './metric-labels.ts'

/** 근거가 부족할 때 — 숫자를 지어내지 않는다 */
export const NOT_ENOUGH = '아직 모름'
export function notEnoughBecause(need: string): string {
  return `${need}이 쌓이면 보여 드릴게요`
}
