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

export type ResolveResult =
  | { productId: string; matched: 'exact_memory' | 'single_variant' }
  | { held: true; reason: ResolveHeldReason }

interface ProductRow { id: string; model_name: string; memory: string | null; gpu_count: number | null }

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

  const { data } = await db.from('gpu_products').select('id, model_name, memory, gpu_count').is('deleted_at', null)
  const all = (data ?? []) as ProductRow[]
  const sameModel = all.filter((p) => coreModelKey(p.model_name) === key)
  if (sameModel.length === 0) return { held: true, reason: 'no_model' }

  const cands = sameModel.filter((p) => (p.gpu_count ?? 1) === cnt)
  if (cands.length === 0) return { held: true, reason: 'no_variant' }

  const memNorm = normalizeMemory(args.memory ?? null)
  if (memNorm) {
    const exact = cands.find((p) => normalizeMemory(p.memory) === memNorm)
    if (exact) return { productId: exact.id, matched: 'exact_memory' }
  }
  if (cands.length === 1) return { productId: cands[0].id, matched: 'single_variant' }
  return { held: true, reason: 'ambiguous_variant' }
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
