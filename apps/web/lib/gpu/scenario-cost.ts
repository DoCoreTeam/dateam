// 시나리오 기반 실효비용 SSOT (v0.7.351 재설계 §6) — 2부/복합 요금제는 "보편 단가"가 수학적으로 불가
//   (사용량의 함수). 대신 기준 사용 시나리오를 정해 성분을 합산한 실효비용으로 비교(Ofgem TCR·Infracost식).
//   저장은 원시 성분(무손실), 비교만 이 결정론 파생. 시간계수 SSOT=hours.ts, 통화 SSOT=normalize-money.
import { HOURS_PER_PERIOD, HOURS_PER_MONTH, MONTHS_PER_PERIOD, type HourPeriod } from './hours.ts'
import { amountToKrw, type FxKrwMap } from './normalize-money.ts'
import type { PriceComponent } from './price-components.ts'

/** 기준 사용 시나리오 — 비교 축을 고정(경량/표준/헤비 등 확장 가능). 기본=표준. */
export interface CostScenario {
  gpuHoursPerMonth: number   // 월 GPU 가동시간(1장 기준). 기본 = HOURS_PER_MONTH(720).
  storageGb: number          // 사용 스토리지 GB.
}
export const STANDARD_SCENARIO: CostScenario = { gpuHoursPerMonth: HOURS_PER_MONTH, storageGb: 1000 }

const isHourPeriod = (u: string): u is HourPeriod =>
  u === 'minute' || u === 'hour' || u === 'day' || u === 'week' || u === 'month' || u === 'year'

/**
 * 성분 배열 → 기준 시나리오의 "GPU 1장 월 실효비용(KRW)". 성분 성격별 합산:
 *   flat(월정액 번들 총액) → ÷gpu_count(1장 몫), base_fee(계정 고정) → 그대로 월비용,
 *   usage(GPU 종량) → 단가 × 월 가동시간(1장), storage(per_gb) → 단가 × storageGb.
 *   환율 미보유 성분이 있으면 null(불완전 — 검수). 시간계열이 아닌 flat의 month는 그대로 월액.
 */
export function effectiveMonthlyKrwPerGpu(
  components: PriceComponent[],
  fx: FxKrwMap,
  scenario: CostScenario = STANDARD_SCENARIO,
): number | null {
  let total = 0
  for (const c of components) {
    const krw = amountToKrw(c.amount, c.currency, fx)
    if (krw == null) return null // 환율 미보유 → 불완전
    const cnt = c.gpu_count && c.gpu_count > 0 ? c.gpu_count : 1
    if (c.component_kind === 'flat') {
      // 월정액 총액 → 월 단위로 정규화 후 1장 몫. 정액요금이므로 달력 계수(MONTHS_PER_PERIOD) 사용.
      const perMonth = isHourPeriod(c.unit) ? krw * MONTHS_PER_PERIOD[c.unit] : krw
      total += perMonth / cnt
    } else if (c.component_kind === 'base_fee') {
      // 계정 고정비 → 월액으로 정규화. 주기가 명시된 단위(year/day/hour…)는 반드시 환산해야 한다.
      //   per_account는 주기 정보가 없는 고정비 → 월액으로 간주(기존 동작 유지).
      //   미정규화 시 年額 기본료가 그대로 월비용에 더해져 12배 과대계상(flat 분기와 같은 규칙 적용).
      total += isHourPeriod(c.unit) ? krw * MONTHS_PER_PERIOD[c.unit] : krw
    } else if (c.component_kind === 'usage') {
      // GPU 종량: 단가(시간계열) × 월 가동시간
      if (!isHourPeriod(c.unit)) return null
      const perHour = krw / HOURS_PER_PERIOD[c.unit] // 단위당→시간당
      total += perHour * scenario.gpuHoursPerMonth
    } else if (c.component_kind === 'storage') {
      // per_gb 월단가 × 사용 GB (per_gb는 통상 월 기준)
      total += krw * scenario.storageGb
    }
  }
  return total
}

/** GPU 1장 시간당 KRW(밴드 비교용) = 월 실효비용 ÷ 시나리오 가동시간. */
export function effectiveKrwPerGpuHour(
  components: PriceComponent[],
  fx: FxKrwMap,
  scenario: CostScenario = STANDARD_SCENARIO,
): number | null {
  const monthly = effectiveMonthlyKrwPerGpu(components, fx, scenario)
  if (monthly == null || scenario.gpuHoursPerMonth <= 0) return null
  return monthly / scenario.gpuHoursPerMonth
}
