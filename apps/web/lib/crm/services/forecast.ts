// 포캐스트 (dacrm FR-09)
//
// **리더가 매주 묻는 것은 하나다**: "이번 분기에 얼마 들어와요?"
// 파이프라인 총액을 그대로 답하면 거짓말이다 — 리드 단계 10억과 계약 직전 10억은
// 같은 10억이 아니다. 그래서 **단계별로 성사 확률을 곱한다.**
//
// **확률을 손으로 넣지 않는다.**
// 흔히 리드 20%·제안 50%·계약 80% 같은 숫자를 관례로 박아 넣는데,
// 그건 어디서도 나온 적 없는 숫자다. 그 숫자로 계산한 예상 매출은
// 정밀해 **보이기만** 하고 근거가 없다 — 그리고 그걸 근거로 사람이 채용을 결정한다.
//
// 대신 **우리가 실제로 겪은 것**에서 뽑는다: 이 단계를 거쳐 간 딜 중 몇 %가 성사됐나.
// 표본이 얇으면 숫자를 내지 않고 "아직 모른다"고 말한다 —
// 딜 세 건으로 만든 33%는 우연이지 확률이 아니다.
//
// 표본 기준은 체류 시간(velocity.ts)과 **같은 값을 쓴다.** 두 벌로 두면 한쪽만 고치게 되고,
// 그러면 같은 화면에서 "근거 있음"과 "근거 없음"이 동시에 뜬다.

import { MIN_SAMPLE } from './velocity.ts'

/** 통화별 금액 — 섞어서 더하지 않는다(리포트와 같은 규칙) */
export interface CurrencySum {
  currency: string
  totalMinor: string
}

export interface StageForecast {
  stageId: string
  stageName: string
  position: number
  /** 지금 이 단계에 서 있는 진행 중 딜 수 */
  openCount: number
  /** 지금 걸려 있는 금액(확률 곱하기 전) */
  pipeline: CurrencySum[]
  /**
   * 이 단계를 거친 딜의 성사율. 표본이 얇으면 null.
   * null 이면 이 단계는 예상 매출에 넣지 않는다 — 모르는 것을 0.5 로 치면 안 된다.
   */
  winRate: number | null
  /** 확률을 판단한 근거 건수 — 사람이 믿을지 말지 정할 재료 */
  sample: number
  /** 확률을 곱한 금액. winRate 가 null 이면 빈 배열 */
  weighted: CurrencySum[]
}

export interface Forecast {
  pipelineId: string
  pipelineName: string
  stages: StageForecast[]
  /** 확률을 낼 수 있었던 단계만 더한 값 */
  weightedTotal: CurrencySum[]
  /** 확률을 못 낸 단계에 걸려 있는 금액 — 숨기면 합계가 조용히 작아진다 */
  unknownTotal: CurrencySum[]
  /** 금액을 아직 안 정한 딜 수 */
  unpriced: number
  /** 사람이 읽는 한 줄 */
  summary: string
}

/** 한 통화 안에서만 덧셈이 성립한다 */
function sumByCurrency(rows: { amountMinor: bigint | string | null; currency: string | null }[]): CurrencySum[] {
  const acc = new Map<string, bigint>()
  for (const r of rows) {
    if (r.amountMinor === null || r.amountMinor === undefined) continue
    const cur = (r.currency ?? 'KRW').toUpperCase()
    try {
      acc.set(cur, (acc.get(cur) ?? BigInt(0)) + BigInt(r.amountMinor))
    } catch {
      // 읽을 수 없는 금액은 버린다 — 합계를 틀리게 만드느니 빼는 편이 낫다
    }
  }
  return Array.from(acc.entries())
    .map(([currency, totalMinor]) => ({ currency, totalMinor: totalMinor.toString() }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
}

function mergeSums(list: CurrencySum[][]): CurrencySum[] {
  const acc = new Map<string, bigint>()
  for (const sums of list) {
    for (const s of sums) acc.set(s.currency, (acc.get(s.currency) ?? BigInt(0)) + BigInt(s.totalMinor))
  }
  return Array.from(acc.entries())
    .map(([currency, totalMinor]) => ({ currency, totalMinor: totalMinor.toString() }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
}

/**
 * 확률을 곱한다.
 *
 * **반올림은 내림으로 한다.** 예상 매출은 넘겨 잡는 쪽이 훨씬 비싸다 —
 * 올려 잡은 숫자로 사람을 뽑으면 그 차액은 사람의 월급이 된다.
 */
function weigh(sums: CurrencySum[], rate: number): CurrencySum[] {
  return sums.map((s) => {
    // BigInt 에는 소수가 없다. 1만분율로 올렸다 내려 정밀도를 지킨다
    const bp = BigInt(Math.round(rate * 10_000))
    return { currency: s.currency, totalMinor: ((BigInt(s.totalMinor) * bp) / BigInt(10_000)).toString() }
  })
}

export interface DealRow {
  id: string
  stageId: string
  status: string
  amountMinor: bigint | null
  currency: string | null
}

/** 어느 딜이 어느 단계를 거쳤나 — 같은 단계를 두 번 거쳐도 한 번으로 센다 */
export interface VisitRow {
  dealId: string
  stageId: string
}

export interface StageDef {
  id: string
  name: string
  position: number
  kind: string
}

/**
 * 단계별 성사율을 낸다.
 *
 * **끝난 딜만 센다.** 진행 중인 딜은 아직 성사도 실패도 아니라서
 * 분모에 넣으면 확률이 실제보다 낮게 나온다("아직 안 됐다"를 "실패했다"로 치는 셈).
 */
export function winRates(
  visits: VisitRow[],
  closed: { id: string; status: string }[],
): Map<string, { rate: number | null; sample: number }> {
  const statusOf = new Map(closed.map((d) => [d.id, d.status]))

  const byStage = new Map<string, { won: number; total: number }>()
  const seen = new Set<string>()

  for (const v of visits) {
    const status = statusOf.get(v.dealId)
    if (!status) continue // 아직 진행 중인 딜 — 결과를 모른다

    const key = `${v.stageId}:${v.dealId}`
    if (seen.has(key)) continue // 같은 단계를 두 번 거쳐도 한 딜은 한 번
    seen.add(key)

    const acc = byStage.get(v.stageId) ?? { won: 0, total: 0 }
    acc.total += 1
    if (status === 'WON') acc.won += 1
    byStage.set(v.stageId, acc)
  }

  const out = new Map<string, { rate: number | null; sample: number }>()
  for (const [stageId, { won, total }] of Array.from(byStage.entries())) {
    // 표본이 얇으면 숫자를 내지 않는다 — 세 건으로 만든 33%는 우연이다
    out.set(stageId, { rate: total >= MIN_SAMPLE ? won / total : null, sample: total })
  }
  return out
}

export function buildForecast(
  pipeline: { id: string; name: string },
  stages: StageDef[],
  deals: DealRow[],
  visits: VisitRow[],
): Forecast {
  const open = deals.filter((d) => d.status === 'OPEN')
  const closed = deals.filter((d) => d.status === 'WON' || d.status === 'LOST')
  const rates = winRates(visits, closed)

  const rows: StageForecast[] = []
  for (const s of stages) {
    // 성사·실패 칸은 "앞으로 들어올 돈"이 아니다 — 이미 끝난 자리다
    if (s.kind === 'WON' || s.kind === 'LOST') continue

    const here = open.filter((d) => d.stageId === s.id)
    const pipelineSum = sumByCurrency(here)
    const r = rates.get(s.id) ?? { rate: null, sample: 0 }

    rows.push({
      stageId: s.id,
      stageName: s.name,
      position: s.position,
      openCount: here.length,
      pipeline: pipelineSum,
      winRate: r.rate,
      sample: r.sample,
      weighted: r.rate === null ? [] : weigh(pipelineSum, r.rate),
    })
  }

  const weightedTotal = mergeSums(rows.filter((r) => r.winRate !== null).map((r) => r.weighted))
  const unknownTotal = mergeSums(rows.filter((r) => r.winRate === null).map((r) => r.pipeline))

  return {
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    stages: rows,
    weightedTotal,
    unknownTotal,
    unpriced: open.filter((d) => d.amountMinor === null || d.amountMinor === undefined).length,
    summary: forecastSummary(rows, weightedTotal, unknownTotal),
  }
}

/** 사람이 읽는 한 줄 — 숫자만 던지면 믿어도 되는지 알 수 없다 */
export function forecastSummary(
  rows: StageForecast[],
  weightedTotal: CurrencySum[],
  unknownTotal: CurrencySum[],
): string {
  const known = rows.filter((r) => r.winRate !== null).length

  if (known === 0) {
    const why = rows.some((r) => r.sample > 0)
      ? `끝난 딜이 단계마다 ${MIN_SAMPLE}건은 있어야 성사율을 낼 수 있어요.`
      : '아직 끝난 딜이 없어 성사율을 낼 수 없어요.'
    return `예상 매출을 아직 낼 수 없습니다. ${why}`
  }

  const head = weightedTotal.length > 0
    ? `단계 ${known}곳의 성사율로 계산한 예상 매출입니다.`
    : '성사율은 냈지만 금액이 걸려 있지 않습니다.'

  return unknownTotal.length > 0
    ? `${head} 근거가 부족한 단계의 금액은 따로 표시했어요.`
    : head
}

export async function buildForecasts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  pipelineId?: string,
): Promise<Forecast[]> {
  const pipelines = await db.crmPipeline.findMany({
    where: pipelineId ? { id: pipelineId } : {},
    select: {
      id: true, name: true,
      stages: { select: { id: true, name: true, position: true, kind: true }, orderBy: { position: 'asc' } },
    },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  }) as { id: string; name: string; stages: StageDef[] }[]

  const out: Forecast[] = []
  for (const p of pipelines) {
    const deals = await db.crmDeal.findMany({
      where: { pipelineId: p.id },
      select: { id: true, stageId: true, status: true, amountMinor: true, currency: true },
    }) as DealRow[]

    /**
     * 어느 딜이 어느 단계를 거쳤나.
     *
     * `toStageId` 를 쓴다 — **들어간** 단계가 그 딜이 도달한 곳이다.
     * 지금 서 있는 자리도 포함해야 하므로 현재 단계를 함께 넣는다
     * (이력이 없는 딜, 즉 만든 뒤 한 번도 안 옮긴 딜이 통째로 빠지는 것을 막는다).
     */
    const history = deals.length > 0
      ? await db.crmStageHistory.findMany({
        where: { dealId: { in: deals.map((d) => d.id) } },
        select: { dealId: true, toStageId: true },
      }) as { dealId: string; toStageId: string }[]
      : []

    const visits: VisitRow[] = [
      ...history.map((h) => ({ dealId: h.dealId, stageId: h.toStageId })),
      ...deals.map((d) => ({ dealId: d.id, stageId: d.stageId })),
    ]

    out.push(buildForecast(p, p.stages, deals, visits))
  }
  return out
}
