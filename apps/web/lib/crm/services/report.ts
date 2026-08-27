/**
 * 리포트 v1 — 파이프라인 합계 (dacrm T1-12)
 *
 * 리포트가 답해야 하는 것은 하나다: **지금 파이프라인에 얼마가 걸려 있나.**
 * 그런데 이 숫자는 틀리기 쉽다 —
 *
 *   ① 통화가 섞이면 더할 수 없다. 원과 달러를 그냥 합치면 그 숫자는 아무 뜻도 없다.
 *      환산해서 하나로 만들지 **않고**, 통화별로 나눠서 보여 준다.
 *      환율은 매일 바뀌는데 리포트에 박아 넣으면 어제 본 숫자와 오늘 본 숫자가 달라진다.
 *
 *   ② 금액 없는 딜은 0원이 아니다. "아직 안 정했다"와 "0원"은 다른 말이다.
 *      합계에서 빼고, 몇 건이 빠졌는지 함께 말한다 — 안 그러면 합계가 조용히 작아진다.
 *
 *   ③ 성사·실패는 진행 중이 아니다. 파이프라인 합계에 WON 이 섞이면
 *      이미 받은 돈을 "앞으로 받을 돈"으로 두 번 세게 된다.
 *
 * 금액은 BigInt 로 더한다. number 로 접으면 2^53 을 넘는 순간 조용히 틀어진다.
 */

import type { CrmDb } from '../db/client.ts'
import { pickBooked } from '../domain/booked-amount.ts'

export interface StageSum {
  stageId: string
  stageName: string
  position: number
  count: number
  /** 통화별 합계 — 섞어서 더하지 않는다 */
  byCurrency: { currency: string; totalMinor: string }[]
  /** 금액을 아직 안 정한 딜 수 */
  unpriced: number
}

export interface PipelineReport {
  pipelineId: string
  pipelineName: string
  /** 진행 중인 딜만 */
  stages: StageSum[]
  openCount: number
  wonCount: number
  lostCount: number
  /** 성사율. 끝난 딜이 없으면 null — 0% 라고 쓰면 "다 실패했다"로 읽힌다 */
  winRate: number | null
  byCurrency: { currency: string; totalMinor: string }[]
  unpriced: number
}

interface DealRow {
  id: string
  stageId: string
  status: string
  amountMinor: bigint | null
  currency: string | null
}

/** 통화별로 모아 더한다 — 한 통화 안에서만 덧셈이 성립한다 */
function sumByCurrency(deals: DealRow[]): { currency: string; totalMinor: string }[] {
  const acc = new Map<string, bigint>()
  for (const d of deals) {
    if (d.amountMinor === null || d.amountMinor === undefined) continue
    const cur = (d.currency ?? 'KRW').toUpperCase()
    acc.set(cur, (acc.get(cur) ?? BigInt(0)) + BigInt(d.amountMinor))
  }
  return Array.from(acc.entries())
    .map(([currency, total]) => ({ currency, totalMinor: total.toString() }))
    // 큰 통화가 먼저 — 화면은 위에서부터 읽힌다
    .sort((a, b) => (BigInt(b.totalMinor) > BigInt(a.totalMinor) ? 1 : -1))
}

function countUnpriced(deals: DealRow[]): number {
  return deals.filter((d) => d.amountMinor === null || d.amountMinor === undefined).length
}

export async function buildPipelineReport(db: CrmDb, pipelineId?: string): Promise<PipelineReport[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipelines = await (db as any).crmPipeline.findMany({
    where: pipelineId ? { id: pipelineId } : {},
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true },
  }) as { id: string; name: string }[]

  const out: PipelineReport[] = []

  for (const p of pipelines) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stages = await (db as any).crmStage.findMany({
      where: { pipelineId: p.id },
      orderBy: { position: 'asc' },
      select: { id: true, name: true, position: true, kind: true },
    }) as { id: string; name: string; position: number; kind: string }[]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await (db as any).crmDeal.findMany({
      where: { pipelineId: p.id },
      select: {
        id: true, stageId: true, status: true, amountMinor: true, currency: true,
        // 「금액」은 이 셋에서 나온다 — 안 실으면 새 3금액만 채운 딜이 전부 「금액 미정」이 된다
        budgetNetMinor: true, quotedNetMinor: true, contractNetMinor: true,
      },
    }) as DealRow[]

    /**
     * 「금액」을 **수주 매출로 통일한다.**
     * 딜 API 는 `toDealJson` 에서 파생하는데 리포트·예측은 DB 를 직접 읽는다 —
     * 안 하면 새 3금액만 채운 딜이 전부 「금액 미정」이 되어
     * 화면이 「9건은 금액 미정이라 합계에서 빠졌어요」라고 **거짓말한다**(실브라우저에서 잡았다).
     */
    const deals = raw.map((d) => {
      const picked = pickBooked(d)
      return picked.from === 'none' ? d : { ...d, amountMinor: picked.minor }
    })

    const open = deals.filter((d) => d.status === 'OPEN')
    const won = deals.filter((d) => d.status === 'WON')
    const lost = deals.filter((d) => d.status === 'LOST')

    const stageSums: StageSum[] = stages
      // 성사·실패 칸은 파이프라인 합계가 아니다 — 아래 winRate 로 따로 말한다
      .filter((s) => s.kind === 'OPEN')
      .map((s) => {
        const mine = open.filter((d) => d.stageId === s.id)
        return {
          stageId: s.id,
          stageName: s.name,
          position: s.position,
          count: mine.length,
          byCurrency: sumByCurrency(mine),
          unpriced: countUnpriced(mine),
        }
      })

    const closed = won.length + lost.length

    out.push({
      pipelineId: p.id,
      pipelineName: p.name,
      stages: stageSums,
      openCount: open.length,
      wonCount: won.length,
      lostCount: lost.length,
      // 끝난 딜이 하나도 없으면 비율을 말하지 않는다 — 표본 0에 0%는 거짓말이다
      winRate: closed === 0 ? null : Math.round((won.length / closed) * 100),
      byCurrency: sumByCurrency(open),
      unpriced: countUnpriced(open),
    })
  }

  return out
}
