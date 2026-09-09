/**
 * 교차검증 실행 (설계서 3.6.5)
 *
 * ## 기본 벤더 결과를 다시 안 부른다
 *
 * 사후 항목별 교차검증은 «이미 있는 답» 에 «다른 벤더의 답» 을 더하는 것이다.
 * 기본 벤더를 다시 부르면 같은 값에 돈을 두 번 낸다.
 *
 * ## 새 판을 만들되 앞 판을 안 덮는다
 *
 * v1 을 고치면 「기본 모드에서는 5억이라 했는데 교차검증 후 6억이 됐다」를 보여 줄 수 없다.
 * 그 이력이 곧 교차검증의 값어치다.
 */

import type { Report, ValueNode, ReportMeta } from '../report/schema.ts'
import { consensus, type FieldKind, type VendorValue, type Verification } from './consensus.ts'

export interface CrossFieldRequest {
  fieldPath: string
  kind: FieldKind
  /** 기본 모드에서 나온 값 — 다시 안 부른다 */
  baseValue: ValueNode<unknown>
}

/** 한 벤더에게 한 필드를 묻는 함수 */
export type CrossRunner = (
  vendorId: string,
  field: CrossFieldRequest,
) => Promise<{ value: unknown; confidence: number | null; costKrw: number }>

export interface CrossFieldResult {
  fieldPath: string
  verification: Verification
  value: unknown
  agreedBy: string[]
  dissent: { vendorId: string; value: unknown }[]
  agreementRate: number
  costKrw: number
}

export interface RunCrossInput {
  fields: readonly CrossFieldRequest[]
  /** 기본 벤더는 여기 안 들어간다 */
  vendorIds: readonly string[]
  baseVendorId: string
}

export interface RunCrossResult {
  results: CrossFieldResult[]
  totalCostKrw: number
  /** 어느 벤더가 실패했나 — 결과가 왜 두 곳뿐인지 설명한다 */
  failedVendors: { vendorId: string; error: string }[]
}

/**
 * 고른 필드만 다른 벤더에 다시 묻고 합의를 낸다.
 *
 * 한 벤더가 죽어도 나머지로 합의를 낸다 — 셋 중 하나가 막혔다고
 * 교차검증 전체를 버리면 사용자는 돈만 쓰고 아무것도 못 얻는다.
 */
export async function runCross(input: RunCrossInput, run: CrossRunner): Promise<RunCrossResult> {
  const results: CrossFieldResult[] = []
  const failedVendors: { vendorId: string; error: string }[] = []
  let totalCostKrw = 0

  // 기본 벤더는 다시 부르지 않는다
  const vendors = input.vendorIds.filter((v) => v !== input.baseVendorId)

  for (const field of input.fields) {
    const values: VendorValue[] = [{
      vendorId: input.baseVendorId,
      value: field.baseValue.value,
      confidence: field.baseValue.confidence,
    }]
    let cost = 0

    for (const vendorId of vendors) {
      try {
        const out = await run(vendorId, field)
        cost += out.costKrw
        values.push({ vendorId, value: out.value, confidence: out.confidence })
      } catch (e) {
        // 셋 중 하나가 막혔다고 전체를 버리면 돈만 쓰고 아무것도 못 얻는다
        const error = e instanceof Error ? e.message : String(e)
        if (!failedVendors.some((f) => f.vendorId === vendorId)) failedVendors.push({ vendorId, error })
      }
    }

    const c = consensus(field.kind, values)
    totalCostKrw += cost
    results.push({
      fieldPath: field.fieldPath,
      verification: c.verification,
      value: c.value,
      agreedBy: c.agreedBy,
      dissent: c.dissent.map((d) => ({ vendorId: d.vendorId, value: d.value })),
      agreementRate: c.agreementRate,
      costKrw: cost,
    })
  }

  return { results, totalCostKrw, failedVendors }
}

/**
 * 교차검증 결과를 새 판 리포트로 만든다 — 앞 판을 고치지 않는다.
 *
 * 검증 안 한 필드는 앞 판 값을 그대로 들고 온다. 검증한 필드만 배지가 바뀐다.
 */
export function applyCross(
  base: Report,
  results: readonly CrossFieldResult[],
  meta: Partial<ReportMeta>,
): Report {
  // 얕은 복사로는 안 된다 — 안쪽 칸을 고치면 앞 판이 함께 바뀐다
  const next: Report = {
    ...base,
    overview: { ...base.overview },
    scope: { ...base.scope },
    schedule: { ...base.schedule },
    budget: { ...base.budget },
    constraints: { ...base.constraints },
    checklist: { ...base.checklist },
    evaluation: { ...base.evaluation },
    meta: { ...base.meta, ...meta, analysisMode: 'cross' },
  }

  for (const r of results) {
    const [bucket, key] = r.fieldPath.split('.')
    const target = (next as unknown as Record<string, Record<string, ValueNode<unknown>>>)[bucket]
    if (!target || !target[key]) continue
    target[key] = {
      ...target[key],
      value: r.value,
      verification: r.verification,
      // 어느 벤더들이 같은 값을 냈는지 남긴다
      vendor: r.agreedBy.join(', '),
    }
  }
  return next
}

/** 불일치 필드 — 화면이 위로 올려 사용자가 고르게 한다 */
export function conflicts(results: readonly CrossFieldResult[]): CrossFieldResult[] {
  return results.filter((r) => r.verification === 'conflict')
}
