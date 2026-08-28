/**
 * 사업 리포트 — 같은 딜을 **세 개의 눈**으로 본다
 *
 * **왜 다시 짓나**: 예전 리포트는 「파이프라인에 얼마가 걸려 있나」 하나만 답했다.
 * 그건 영업의 질문이고, 회계와 경영은 다른 것을 묻는다 —
 * 「이번 달 매출로 잡히는 게 얼마인가」·「돈은 언제 들어오나」·「따냈는데 아직 안 판 게 얼마인가」.
 * (사용자 지적: 「매출관점이든 회계 관점이든 영업관점이든 리포트가 명확해야 하고
 *  마감, 시점, 대상, 금액, 상세 이런 리포트에 담겨야 하는 항목이…」)
 *
 * **표준 용어를 쓴다** — 우리가 지어내면 회계·경영진과 말이 안 통한다:
 *   · 수주(Bookings)     계약한 시점에 **계약 총액**을 통째로 센다
 *   · 인식 매출(Revenue) 사업 기간에 **나눠서** 센다 — 한국 용역·건설 회계의 진행기준과 같은 갈래다
 *   · 현금(Cash)         현물을 뺀 금액. 현물은 돈으로 들어오지 않는다
 *   · 수주잔고(Backlog)  누적 수주 − 누적 인식. 다음 기간 매출의 기반
 *
 * **모르는 것은 모른다고 말한다.** 기간을 모르는 사업(크레딧 소진 시까지 등)은
 * 인식 매출을 계산할 방법이 없다 — 0 으로도, 전액으로도 치지 않고 **따로 세어 밝힌다.**
 * 0 으로 치면 매출이 조용히 사라지고, 전액으로 치면 아직 못 판 것을 판 것으로 만든다.
 */

import type { CrmDb } from '../db/client.ts'
import { pickBooked } from '../domain/booked-amount.ts'
import { allocateByMonth } from '../domain/allocation.ts'
import type { PeriodRange, GroupKey } from '../domain/report-axis.ts'

export interface CurrencySum {
  currency: string
  totalMinor: string
}

export interface TimelinePoint {
  /** `YYYY-MM` */
  key: string
  label: string
  bookings: CurrencySum[]
  recognized: CurrencySum[]
}

export interface GroupRow {
  key: string
  label: string
  count: number
  bookings: CurrencySum[]
  recognized: CurrencySum[]
}

export interface ReportDealRow {
  id: string
  name: string
  companyName: string | null
  ownerName: string | null
  businessType: string | null
  /** `YYYY-MM-DD` — 언제 따냈나 */
  wonAt: string | null
  currency: string
  /** 계약 총액 */
  bookedMinor: string
  /** 이 기간에 매출로 잡히는 몫 */
  recognizedMinor: string
  /** 기간을 몰라 배분하지 못했나 */
  recognitionUnknown: boolean
  termLabel: string | null
}

export interface BusinessReport {
  period: PeriodRange
  /** ── 금액 ─────────────────────────────── */
  /** 이 기간에 **따낸** 계약 총액 */
  bookings: CurrencySum[]
  bookingsCount: number
  /** 이 기간에 **매출로 잡히는** 몫 */
  recognized: CurrencySum[]
  /** 현물을 뺀 몫 — 실제로 들어오는 돈 */
  cash: CurrencySum[]
  /** 기간 끝 시점의 수주잔고 = 누적 수주 − 누적 인식 */
  backlog: CurrencySum[]
  /** 기간을 몰라 인식 매출에서 뺀 딜 — 숨기면 매출이 조용히 작아진다 */
  recognitionUnknownCount: number
  recognitionUnknownAmount: CurrencySum[]
  /** ── 시점 ─────────────────────────────── */
  timeline: TimelinePoint[]
  /** ── 대상 ─────────────────────────────── */
  groupBy: GroupKey
  groups: GroupRow[]
  /** ── 상세 ─────────────────────────────── */
  deals: ReportDealRow[]
}

// ------------------------------------------------------------

/** 통화별로만 더한다 — 원과 달러를 합친 숫자는 아무 뜻이 없다 */
function toSums(acc: Map<string, bigint>): CurrencySum[] {
  return Array.from(acc.entries())
    .filter(([, v]) => v !== BigInt(0))
    .map(([currency, total]) => ({ currency, totalMinor: total.toString() }))
    .sort((a, b) => (BigInt(b.totalMinor) > BigInt(a.totalMinor) ? 1 : -1))
}

function add(acc: Map<string, bigint>, currency: string, minor: bigint): void {
  acc.set(currency, (acc.get(currency) ?? BigInt(0)) + minor)
}

function dateKey(d: Date | null | undefined): string | null {
  if (!d) return null
  return d.toISOString().slice(0, 10)
}

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7)
}

/** 기간 안에 든 달들 — `['2026-08', …]` */
function monthsBetween(from: string, to: string): string[] {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  const out: string[] = []
  let y = fy
  let m = fm
  // 12년(144개월)을 넘기지 않는다 — 실수로 1900년을 넣어도 무한히 돌지 않게
  for (let i = 0; i < 144 && (y < ty || (y === ty && m <= tm)); i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return out
}

interface RawDeal {
  id: string
  name: string
  status: string
  currency: string | null
  amountMinor: bigint | null
  budgetNetMinor: bigint | null
  quotedNetMinor: bigint | null
  contractNetMinor: bigint | null
  bookedNetMinor: bigint | null
  inKindTotalMinor: bigint | null
  startDate: Date | null
  endDate: Date | null
  endDateUnknown: boolean
  termMonths: number | null
  businessType: string | null
  wonAt: Date | null
  ownerId: string | null
  pipelineId: string
  stageId: string
  company: { name: string } | null
}

/**
 * 한 딜이 **어느 달에 얼마씩** 매출로 잡히나.
 *
 * 규칙은 셋뿐이다:
 *   ① 시작·종료가 다 있으면 **그 기간에 월할**한다(진행기준의 가장 단순한 형태)
 *   ② 기간이 없으면 **따낸 달에 전액** — 단발 납품이 그렇다
 *   ③ 종료를 **모른다고 표시된 사업**은 배분하지 않는다 — 크레딧처럼 소진 시점을 알 수 없다
 *
 * ③ 을 ① 로 억지로 밀어 넣지 않는다. 끝을 모르는 것을 아는 척하면
 * 그 숫자는 매달 틀리고, 틀린 줄도 모른다.
 */
export function recognitionSchedule(d: {
  bookedMinor: bigint
  startDate: Date | null
  endDate: Date | null
  endDateUnknown: boolean
  wonAt: Date | null
}): { byMonth: Map<string, bigint>; unknown: boolean } {
  const byMonth = new Map<string, bigint>()
  if (d.bookedMinor === BigInt(0)) return { byMonth, unknown: false }

  if (d.endDateUnknown) return { byMonth, unknown: true }

  if (d.startDate && d.endDate) {
    for (const m of allocateByMonth(d.bookedMinor, d.startDate, d.endDate)) {
      byMonth.set(`${m.year}-${String(m.month).padStart(2, '0')}`, m.amountMinor)
    }
    return { byMonth, unknown: false }
  }

  const anchor = d.wonAt ?? d.startDate
  if (!anchor) return { byMonth, unknown: true }
  byMonth.set(monthKey(anchor), d.bookedMinor)
  return { byMonth, unknown: false }
}

function groupOf(d: RawDeal, by: GroupKey, names: {
  pipelines: Map<string, string>; stages: Map<string, string>; members: Map<string, string>
}): { key: string; label: string } {
  if (by === 'OWNER') {
    const label = d.ownerId ? names.members.get(d.ownerId) ?? '담당자 없음' : '담당자 없음'
    return { key: d.ownerId ?? '(없음)', label }
  }
  if (by === 'COMPANY') return { key: d.company?.name ?? '(없음)', label: d.company?.name ?? '회사 없음' }
  if (by === 'PIPELINE') return { key: d.pipelineId, label: names.pipelines.get(d.pipelineId) ?? d.pipelineId }
  if (by === 'STAGE') return { key: d.stageId, label: names.stages.get(`${d.pipelineId}:${d.stageId}`) ?? d.stageId }
  return { key: d.businessType ?? '(없음)', label: d.businessType ?? '유형 없음' }
}

export interface BusinessReportInput {
  period: PeriodRange
  groupBy: GroupKey
  pipelineId?: string
}

export async function buildBusinessReport(
  db: CrmDb,
  input: BusinessReportInput,
): Promise<BusinessReport> {
  const { period, groupBy } = input

  /**
   * **성사된 딜만 본다.**
   * 매출·회계의 질문은 「따낸 것」에 대한 것이다. 진행 중인 딜은 아직 매출이 아니다 —
   * 그건 영업의 질문이고 파이프라인·예상 매출이 따로 답한다.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await (db as any).crmDeal.findMany({
    where: { status: 'WON', ...(input.pipelineId ? { pipelineId: input.pipelineId } : {}) },
    select: {
      id: true, name: true, status: true, currency: true, amountMinor: true,
      budgetNetMinor: true, quotedNetMinor: true, contractNetMinor: true, bookedNetMinor: true,
      inKindTotalMinor: true,
      startDate: true, endDate: true, endDateUnknown: true, termMonths: true,
      businessType: true, wonAt: true, ownerId: true, pipelineId: true, stageId: true,
      company: { select: { name: true } },
      // 담당자 이름은 **따로 읽는다** — crm_deal 은 ownerId 만 들고 관계가 없다
    },
    orderBy: { wonAt: 'desc' },
  }) as RawDeal[]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipelineRows = await (db as any).crmPipeline.findMany({
    select: { id: true, name: true, stages: { select: { id: true, name: true } } },
  }) as { id: string; name: string; stages: { id: string; name: string }[] }[]
  const pipelineNames = new Map(pipelineRows.map((p) => [p.id, p.name]))
  const stageNames = new Map(
    pipelineRows.flatMap((p) => p.stages.map((s) => [`${p.id}:${s.id}`, s.name] as const)),
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const memberRows = await (db as any).crmMember.findMany({
    select: { id: true, displayName: true },
  }) as { id: string; displayName: string }[]
  const memberNames = new Map(memberRows.map((m) => [m.id, m.displayName]))

  const months = monthsBetween(period.from.slice(0, 7), period.to.slice(0, 7))
  const monthSet = new Set(months)

  const bookings = new Map<string, bigint>()
  const recognized = new Map<string, bigint>()
  const cash = new Map<string, bigint>()
  const backlog = new Map<string, bigint>()
  const unknownAmount = new Map<string, bigint>()
  const timelineAcc = new Map<string, { b: Map<string, bigint>; r: Map<string, bigint> }>()
  for (const m of months) timelineAcc.set(m, { b: new Map(), r: new Map() })
  const groupAcc = new Map<string, { label: string; count: number; b: Map<string, bigint>; r: Map<string, bigint> }>()

  let bookingsCount = 0
  let unknownCount = 0
  const deals: ReportDealRow[] = []

  for (const d of raw) {
    const picked = pickBooked(d)
    if (picked.from === 'none') continue
    const bookedMinor = picked.minor
    const currency = (d.currency ?? 'KRW').toUpperCase()
    const wonKey = dateKey(d.wonAt)
    const inPeriodBooking = wonKey !== null && wonKey >= period.from && wonKey <= period.to

    // ── 수주: 따낸 날이 이 기간 안이면 **계약 총액을 통째로**
    if (inPeriodBooking) {
      add(bookings, currency, bookedMinor)
      bookingsCount += 1
      const tp = timelineAcc.get(monthKey(d.wonAt as Date))
      if (tp) add(tp.b, currency, bookedMinor)
    }

    // ── 인식 매출: 기간에 나눠 담은 몫 중 이 기간에 걸린 것만
    const sched = recognitionSchedule({
      bookedMinor, startDate: d.startDate, endDate: d.endDate,
      endDateUnknown: d.endDateUnknown, wonAt: d.wonAt,
    })
    let recInPeriod = BigInt(0)
    for (const [mk, amt] of Array.from(sched.byMonth.entries())) {
      if (monthSet.has(mk)) {
        recInPeriod += amt
        const tp = timelineAcc.get(mk)
        if (tp) add(tp.r, currency, amt)
      }
      // 수주잔고 = 기간 끝까지 **아직 인식되지 않은** 몫
      if (mk > period.to.slice(0, 7)) add(backlog, currency, amt)
    }
    if (recInPeriod !== BigInt(0)) add(recognized, currency, recInPeriod)

    if (sched.unknown) {
      unknownCount += 1
      add(unknownAmount, currency, bookedMinor)
      // 배분을 못 한 것은 **전부 잔고**다 — 따냈지만 아직 매출로 안 잡혔다
      add(backlog, currency, bookedMinor)
    }

    /**
     * 현금 = 인식 매출 − 현물 몫.
     * 현물은 장비·인력처럼 **물건으로 받은 것**이라 통장에 찍히지 않는다.
     * 계약 총액에서 현물이 차지하는 비율만큼 인식분에서도 뺀다.
     */
    const inKind = d.inKindTotalMinor ?? BigInt(0)
    const cashInPeriod = inKind > BigInt(0) && bookedMinor > BigInt(0)
      ? recInPeriod - (recInPeriod * inKind) / bookedMinor
      : recInPeriod
    if (cashInPeriod !== BigInt(0)) add(cash, currency, cashInPeriod)

    // ── 대상별
    if (inPeriodBooking || recInPeriod !== BigInt(0)) {
      const g = groupOf(d, groupBy, { pipelines: pipelineNames, stages: stageNames, members: memberNames })
      const cur = groupAcc.get(g.key) ?? { label: g.label, count: 0, b: new Map(), r: new Map() }
      cur.count += 1
      if (inPeriodBooking) add(cur.b, currency, bookedMinor)
      if (recInPeriod !== BigInt(0)) add(cur.r, currency, recInPeriod)
      groupAcc.set(g.key, cur)

      deals.push({
        id: d.id,
        name: d.name,
        companyName: d.company?.name ?? null,
        ownerName: d.ownerId ? memberNames.get(d.ownerId) ?? null : null,
        businessType: d.businessType,
        wonAt: wonKey,
        currency,
        bookedMinor: bookedMinor.toString(),
        recognizedMinor: recInPeriod.toString(),
        recognitionUnknown: sched.unknown,
        termLabel: termLabelOf(d),
      })
    }
  }

  return {
    period,
    bookings: toSums(bookings),
    bookingsCount,
    recognized: toSums(recognized),
    cash: toSums(cash),
    backlog: toSums(backlog),
    recognitionUnknownCount: unknownCount,
    recognitionUnknownAmount: toSums(unknownAmount),
    timeline: months.map((m) => {
      const tp = timelineAcc.get(m)
      const [y, mm] = m.split('-')
      return {
        key: m,
        label: `${y}년 ${Number(mm)}월`,
        bookings: toSums(tp?.b ?? new Map()),
        recognized: toSums(tp?.r ?? new Map()),
      }
    }),
    groupBy,
    groups: Array.from(groupAcc.entries())
      .map(([key, v]) => ({
        key, label: v.label, count: v.count,
        bookings: toSums(v.b), recognized: toSums(v.r),
      }))
      // 큰 것이 먼저 — 사람은 위에서부터 읽는다
      .sort((a, b) => {
        const av = a.bookings[0] ? BigInt(a.bookings[0].totalMinor) : BigInt(0)
        const bv = b.bookings[0] ? BigInt(b.bookings[0].totalMinor) : BigInt(0)
        return bv > av ? 1 : bv < av ? -1 : 0
      }),
    // 최근에 따낸 것이 먼저
    deals: deals.sort((a, b) => (b.wonAt ?? '').localeCompare(a.wonAt ?? '')),
  }
}

function termLabelOf(d: RawDeal): string | null {
  if (d.endDateUnknown) return d.startDate ? `${dateKey(d.startDate)} ~ 종료 미정` : '종료 미정'
  if (d.startDate && d.endDate) {
    const n = d.termMonths
    return `${dateKey(d.startDate)} ~ ${dateKey(d.endDate)}${n ? ` (${n}개월)` : ''}`
  }
  return null
}
