// 공용 Tier→모델 그룹 빌더 (docs 01 §3, 02 §3)
// 4개 메뉴(가격표/시장비교/재고/고객가)가 동일한 카테고리 구조를 쓰도록 단일 그룹화 로직.

export interface TierModelItemLike {
  model_name: string
  tier: number
  gpu_count?: number
}

export interface ModelGroup<T> {
  model: string
  tier: number
  items: T[]
}

export interface TierGroup<T> {
  tier: number
  models: ModelGroup<T>[]
  count: number // 모델 수
  itemCount: number // 전체 상품/구성 수
}

export const TIER_META: Record<number, { label: string; name: string; badge: string }> = {
  1: { label: 'Tier 1', name: '전용 고성능', badge: 'gpu-badge-t1' },
  2: { label: 'Tier 2', name: '점유형', badge: 'gpu-badge-t2' },
  3: { label: 'Tier 3', name: '간헐 공급', badge: 'gpu-badge-t3' },
}

/** items를 Tier→모델 2단계로 그룹화. Tier 오름차순, 모델 가나다순, 구성은 gpu_count 오름차순. */
export function buildTierModelGroups<T extends TierModelItemLike>(items: T[]): TierGroup<T>[] {
  const byTier = new Map<number, Map<string, T[]>>()
  for (const it of items) {
    const tier = it.tier
    if (!byTier.has(tier)) byTier.set(tier, new Map())
    const modelMap = byTier.get(tier)!
    const arr = modelMap.get(it.model_name) ?? []
    arr.push(it)
    modelMap.set(it.model_name, arr)
  }

  const tiers: TierGroup<T>[] = []
  Array.from(byTier.keys())
    .sort((a, b) => a - b)
    .forEach((tier) => {
      const modelMap = byTier.get(tier)!
      const models: ModelGroup<T>[] = Array.from(modelMap.entries())
        .sort(([a], [b]) => a.localeCompare(b, 'ko'))
        .map(([model, arr]) => ({
          model,
          tier,
          items: [...arr].sort((x, y) => (x.gpu_count ?? 1) - (y.gpu_count ?? 1)),
        }))
      tiers.push({
        tier,
        models,
        count: models.length,
        itemCount: models.reduce((a, m) => a + m.items.length, 0),
      })
    })
  return tiers
}

/** 그룹 접기 키 헬퍼 — Tier / 모델 식별자 일관 */
export const tierKey = (tier: number) => `tier:${tier}`
export const modelKey = (tier: number, model: string) => `model:${tier}:${model}`
