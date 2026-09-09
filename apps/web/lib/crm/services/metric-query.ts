// 지표 조회 — 딜을 한 번 읽어 순수 엔진에 넘긴다
//
// **이 파일은 얇다.** 계산은 `domain/metric-agg.ts` 가 한다.
// 나누는 이유: 숫자가 틀렸을 때 「쿼리가 틀렸나 계산이 틀렸나」를 가릴 수 있어야 하고,
// 계산이 순수해야 실브라우저 없이 숫자로 잠글 수 있다(완료 조건 E-6).
//
// **한 번만 읽는다.** 카드 아홉 개를 그리려고 아홉 번 조회하면 화면이 아홉 시점을
// 나란히 놓게 되고, 「수주는 3억인데 파이프라인이 0」 같은 줄을 설명할 수 없다.
// 그래서 딜을 한 번 읽어 여러 지표를 같은 배열 위에서 돌린다.

import type { CrmDb } from '../db/client.ts'
import {
  aggregate, bucketOf, EMPTY_KEY,
  type AggDeal, type AggResult, type QuerySpec,
} from '../domain/metric-agg.ts'
import { isHiddenPipelineName } from '../domain/dimensions.ts'

/** 한 번에 읽는 딜 수 상한 — 넘으면 잘랐다고 말한다. 조용히 자르면 「이게 전부」로 읽힌다 */
export const DEAL_SCAN_LIMIT = 5000

export interface LoadedDeals {
  deals: AggDeal[]
  /** 상한에 걸려 잘렸나 */
  truncated: boolean
  /** 축에서 숨긴 파이프라인 이름 — 왜 안 보이는지 화면이 말할 수 있게 */
  hiddenPipelines: string[]
}

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null
  return v instanceof Date ? v.toISOString() : String(v)
}

/**
 * 리포트가 볼 딜을 전부 읽는다.
 *
 * 삭제된 딜은 워크스페이스 가드가 알아서 빼 준다(소프트 삭제 SSOT).
 * 단계 진입 시각은 **마지막 단계 이동**이고, 이동한 적이 없으면 만든 날이다 —
 * 첫 단계에는 만들어진 순간부터 있었던 것이 사실이다.
 */
export async function loadDealsForMetrics(db: CrmDb): Promise<LoadedDeals> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const anyDb = db as any

  const [rows, bizOptions] = await Promise.all([
    anyDb.crmDeal.findMany({
      take: DEAL_SCAN_LIMIT + 1,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, status: true, createdAt: true, wonAt: true, expectedCloseDate: true,
        startDate: true, endDate: true, currency: true,
        contractNetMinor: true, quotedNetMinor: true, budgetNetMinor: true, amountMinor: true,
        businessTypeKey: true, ownerId: true,
        stage: { select: { id: true, name: true, winProbabilityPct: true } },
        pipeline: { select: { id: true, name: true } },
        owner: { select: { id: true, displayName: true } },
        company: {
          select: {
            id: true, name: true, industry: true, region: true, employeeRange: true, domain: true,
          },
        },
        history: { select: { movedAt: true }, orderBy: { movedAt: 'desc' }, take: 1 },
      },
    }),
    anyDb.crmBusinessTypeOption.findMany({ select: { key: true, label: true } }),
  ])

  const truncated = rows.length > DEAL_SCAN_LIMIT
  const kept = truncated ? rows.slice(0, DEAL_SCAN_LIMIT) : rows
  const bizLabel = new Map<string, string>(bizOptions.map((b: any) => [b.key, b.label]))

  const hidden = new Set<string>()
  const deals: AggDeal[] = kept.map((r: any) => {
    // 검증용 파이프라인은 이름으로 티가 난다. **딜이 붙어 있으면 숨기지 않는다** —
    // 숨기면 합이 조용히 줄고 그 차이를 아무도 못 찾는다. 이름만 적어 화면이 말하게 한다
    if (r.pipeline && isHiddenPipelineName(r.pipeline.name)) hidden.add(r.pipeline.name)

    return {
      id: r.id,
      status: r.status,
      createdAtIso: iso(r.createdAt) ?? new Date(0).toISOString(),
      wonAtIso: iso(r.wonAt),
      expectedCloseIso: iso(r.expectedCloseDate),
      startDateIso: iso(r.startDate),
      endDateIso: iso(r.endDate),
      stageEnteredAtIso: iso(r.history?.[0]?.movedAt) ?? iso(r.createdAt),
      currency: r.currency ?? null,
      contractNetMinor: r.contractNetMinor ?? null,
      quotedNetMinor: r.quotedNetMinor ?? null,
      budgetNetMinor: r.budgetNetMinor ?? null,
      amountMinor: r.amountMinor ?? null,
      // 없으면 null 이다 — 0 으로 접으면 가중 예상이 조용히 줄어든다
      winProbabilityPct: typeof r.stage?.winProbabilityPct === 'number' ? r.stage.winProbabilityPct : null,
      stage: r.stage ? { id: r.stage.id, name: r.stage.name } : null,
      pipeline: r.pipeline ? { id: r.pipeline.id, name: r.pipeline.name } : null,
      businessType: r.businessTypeKey
        ? { id: r.businessTypeKey, name: bizLabel.get(r.businessTypeKey) ?? r.businessTypeKey }
        : null,
      owner: r.owner ? { id: r.owner.id, name: r.owner.displayName } : null,
      company: r.company
        ? {
          id: r.company.id, name: r.company.name,
          industry: r.company.industry ?? null,
          region: r.company.region ?? null,
          employeeRange: r.company.employeeRange ?? null,
          domain: r.company.domain ?? null,
        }
        : null,
    }
  })

  return { deals, truncated, hiddenPipelines: Array.from(hidden) }
}

/**
 * 지표 여럿을 **같은 딜 배열 위에서** 돌린다.
 *
 * 그래야 카드들이 같은 시점을 말한다. 지표마다 따로 조회하면 그 사이에 딜이
 * 바뀌어 「합이 안 맞는」 화면이 나오고, 그건 재현이 안 돼서 못 고친다.
 */
export function runMetrics(
  loaded: LoadedDeals,
  specs: readonly QuerySpec[],
): AggResult[] {
  return specs.map((s) => aggregate(loaded.deals, s))
}

/** 축이 지금 쓸 만한지 — 채워진 비율. 화면이 「이 기준은 아직 뜻이 없다」를 말하려고 쓴다 */
export function dimensionFill(
  loaded: LoadedDeals,
  dimensionKey: string,
): { filled: number; total: number } {
  let filled = 0
  for (const d of loaded.deals) {
    // 순수 엔진의 판정을 그대로 쓴다 — 여기서 다시 짜면 화면과 축이 어긋난다
    if (bucketOf(d, dimensionKey).key !== EMPTY_KEY) filled += 1
  }
  return { filled, total: loaded.deals.length }
}
