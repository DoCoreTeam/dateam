// GPU 구성 사다리 SSOT — 표준단 정규화 + 1장 환산
//
// 모든 입력경로(quotes POST / review confirm / derive-configs)는 이 모듈을 경유해
// gpu_count를 표준 사다리 1·2·4·8 중 하나로 정규화한다.
//
// 정책 (DECISION-20260608-x3-policy.md):
//   · 표준 사다리 = [1, 2, 4, 8]
//   · 비표준(x3 등) → n 이상 최소 표준단으로 올림 (x3→x4, x5~x8→x8, x9+→x8 클램프)
//   · 1장 환산: per_gpu = 구성_총액 ÷ gpu_count (pricing.ts perGpuOf와 동일 원리)

export const STANDARD_LADDER = [1, 2, 4, 8] as const
export type StandardCount = (typeof STANDARD_LADDER)[number]

const PRECISION = 10000 // 소수 4자리 반올림 (pricing.ts PER_GPU_DP와 동일)
const MAX_STANDARD = 8

/**
 * n 이상인 표준 사다리 중 가장 작은 값을 반환한다.
 * n <= 0 또는 NaN → 1 (최소 표준단)
 * n > 8 → 8 (클램프)
 *
 * 예: 1→1, 2→2, 3→4, 5→8, 6→8, 7→8, 8→8, 9→8, 0→1, -1→1
 */
export function roundUpToStandard(n: number): StandardCount {
  if (!Number.isFinite(n) || n <= 0) return 1
  if (n > MAX_STANDARD) return MAX_STANDARD
  for (const s of STANDARD_LADDER) {
    if (s >= n) return s
  }
  return MAX_STANDARD
}

/** n이 표준 사다리에 속하는지 확인 */
export function isStandardConfig(n: number): boolean {
  return (STANDARD_LADDER as readonly number[]).includes(n)
}

/**
 * 구성 총액(totalUnitForCount)과 실제 gpu_count로부터 1장당 단가를 산출한다.
 * pricing.ts perGpuOf와 동일 로직 — 호출처에서 혼용하지 말고 이쪽을 사용할 것.
 *
 * count <= 0 또는 NaN 방어: count를 1로 클램프.
 */
export function perGpuUnitPrice(totalUnitForCount: number, count: number): number {
  if (!Number.isFinite(totalUnitForCount)) return 0
  const n = Math.max(1, Number.isFinite(count) ? count : 1)
  return Math.round((totalUnitForCount / n) * PRECISION) / PRECISION
}

/**
 * 1장당 단가(perGpu)와 목표 gpu_count로부터 해당 구성의 총 단가를 산출한다.
 * ensureStandardConfigs 누락단 보충 / 사다리 전파에서 사용.
 *
 * targetCount <= 0 또는 NaN 방어: targetCount를 1로 클램프.
 */
export function priceForStandardConfig(perGpu: number, targetCount: number): number {
  if (!Number.isFinite(perGpu)) return 0
  const n = Math.max(1, Number.isFinite(targetCount) ? targetCount : 1)
  return Math.round(perGpu * n * PRECISION) / PRECISION
}
