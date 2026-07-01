// 모델 변형 매칭 SSOT — "확실히 식별되면 기존 행 재사용, 애매하면 추측 말고 보류".
// 경쟁사/공급사 확정 전 경로가 모두 이 함수만 호출(복붙 금지). 깡통 자동생성 차단의 단일 통제점.
//
// 왜: 입력(모델표기·메모리포맷·vCPU/RAM·장수)은 무한 다양. 특정 케이스 패치는 두더지잡기.
//   매칭은 캐노니컬 모델명 + 장수(gpu_count)로만. memory는 "키"가 아니라 변형 구분용 세부데이터.
//   단 같은 장수에 메모리가 진짜 다른 별개 SKU(예: RTX 3060 8GB vs 12GB)가 여럿이면 → 잘못 병합 금지 위해 보류.

import { coreModelKey } from './canonical-model.ts'
import { normalizeMemory } from './normalize.ts'

export type ResolveHeldReason =
  | 'no_model'          // 캐노니컬 키가 같은 모델이 카탈로그에 전혀 없음 → 스펙관리에서 모델 먼저 등록
  | 'no_variant'        // 모델은 있으나 그 장수 구성이 없음
  | 'ambiguous_variant' // 같은 장수에 메모리가 다른 변형이 여럿인데 memory로 특정 불가 → 잘못 병합 차단

/** 보류 시 사용자가 그 자리서 고를 수 있는 후보 변형(같은 모델·장수, 메모리만 다름) */
export interface VariantCandidate { id: string; memory: string | null; gpuCount: number }

export type ResolveResult =
  | { productId: string; matched: 'exact_memory' | 'single_variant' }
  | { held: true; reason: ResolveHeldReason; candidates?: VariantCandidate[] }

interface ProductRow { id: string; model_name: string; memory: string | null; gpu_count: number | null; strategic_price_krw: number | null }

/** 완전중복 후보 중 대표 1행 선택 — 확정가가 그 행에 반영되도록 '가격 보유행' 우선, 동률은 id 사전순(안정·결정론). */
function pickRepresentative(rows: ProductRow[]): ProductRow {
  return [...rows].sort((a, b) => {
    const ap = a.strategic_price_krw != null ? 0 : 1
    const bp = b.strategic_price_krw != null ? 0 : 1
    if (ap !== bp) return ap - bp
    return String(a.id).localeCompare(String(b.id))
  })[0]
}

export interface ResolveArgs {
  modelName: string
  /** 기본 1(경쟁사 on-demand=1장). 공급사는 파싱된 장수 주입 */
  gpuCount?: number
  /** 있으면 변형 정확매칭에 사용. 없거나 불일치여도 단일 변형이면 흡수(드리프트) */
  memory?: string | null
}

/**
 * (modelName, gpuCount, memory?) → 기존 gpu_products 행 매칭. 절대 INSERT하지 않음(읽기 전용).
 * 1) memory가 기존 변형과 일치          → 그 변형
 * 2) 그 모델·장수 변형이 정확히 1개      → 그 변형 (메모리 드리프트/결측 흡수)
 * 3) 변형 여럿인데 memory로 특정 불가    → 보류(ambiguous_variant)
 * 4) 모델은 있으나 그 장수 변형 없음     → 보류(no_variant)
 * 5) 모델 자체 없음                      → 보류(no_model)
 */
export async function resolveProductId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  args: ResolveArgs,
): Promise<ResolveResult> {
  const key = coreModelKey(args.modelName)
  if (!key) return { held: true, reason: 'no_model' }
  const cnt = typeof args.gpuCount === 'number' && args.gpuCount > 0 ? args.gpuCount : 1

  const { data } = await db.from('gpu_products').select('id, model_name, memory, gpu_count, strategic_price_krw').is('deleted_at', null)
  const all = (data ?? []) as ProductRow[]
  const sameModel = all.filter((p) => coreModelKey(p.model_name) === key)
  if (sameModel.length === 0) return { held: true, reason: 'no_model' }

  const cands = sameModel.filter((p) => (p.gpu_count ?? 1) === cnt)
  if (cands.length === 0) return { held: true, reason: 'no_variant' }

  const memNorm = normalizeMemory(args.memory ?? null)
  if (memNorm) {
    // 지정 메모리 일치 — 완전중복행이 여럿이어도 대표 1개로 확정(떠넘기지 않음).
    const exact = cands.filter((p) => normalizeMemory(p.memory) === memNorm)
    if (exact.length > 0) return { productId: pickRepresentative(exact).id, matched: 'exact_memory' }
  }

  // 후보를 '서로 다른 정규화 메모리'로 그룹핑 — 완전중복행(같은 메모리)은 하나의 SKU로 취급.
  // 데이터 오염(동일 행 중복 등록)이 'ambiguous_variant'로 오판돼 사용자에게 떠넘겨지던 문제 차단.
  const byMem = new Map<string, ProductRow[]>()
  for (const p of cands) {
    const m = normalizeMemory(p.memory) ?? ''
    const grp = byMem.get(m)
    if (grp) grp.push(p)
    else byMem.set(m, [p])
  }
  if (byMem.size === 1) {
    // 메모리 종류가 실질 1개 → 중복행이든 단일행이든 대표 1개로 자동확정.
    return { productId: pickRepresentative(cands).id, matched: 'single_variant' }
  }

  // 서로 다른 메모리가 진짜 여럿(예: V100 16GB vs 32GB) → 보류. 후보는 메모리별 대표만(중복 제거).
  const candidates: VariantCandidate[] = Array.from(byMem.values()).map((grp) => {
    const rep = pickRepresentative(grp)
    return { id: rep.id, memory: rep.memory, gpuCount: rep.gpu_count ?? 1 }
  })
  return { held: true, reason: 'ambiguous_variant', candidates }
}

/** 보류 사유 → 사용자 안내 문구(확정 차단 시 표시). */
export function heldReasonMessage(reason: ResolveHeldReason, modelName: string, gpuCount?: number): string {
  switch (reason) {
    case 'no_model':
      return `모델 '${modelName}'이(가) 카탈로그에 없습니다. 스펙 관리에서 모델을 먼저 등록한 뒤 확정하세요.`
    case 'no_variant':
      return `모델 '${modelName}'에 ${gpuCount ?? 1}장 구성이 없습니다. 스펙 관리에서 해당 구성을 등록한 뒤 확정하세요.`
    case 'ambiguous_variant':
      return `모델 '${modelName}'의 변형을 메모리로 특정할 수 없습니다(같은 장수에 메모리가 다른 변형이 여럿). 메모리를 지정한 뒤 확정하세요.`
  }
}
