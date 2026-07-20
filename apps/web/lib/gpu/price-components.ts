// 요금성분 1:N SSOT (v0.7.351 재설계 §3) — 관측 1건 = 성분 N개.
//   복합요금(기본료+종량+스토리지)을 무손실 표현. DB=market_price_components(마이그165).
//   환산·나눗셈은 100% 코드(AI 금지). 시간계수 SSOT=hours.ts, 통화환산 SSOT=normalize-money.
import { HOURS_PER_PERIOD, type HourPeriod } from './hours.ts'
import { amountToKrw, type FxKrwMap } from './normalize-money.ts'

export type ComponentKind = 'base_fee' | 'usage' | 'storage' | 'flat'
export type ComponentUnit = HourPeriod | 'per_gb' | 'per_account'
export type TaxBasis = 'tax_excluded' | 'tax_included' | 'unknown'

/** 관측 성분 1개(원본 무손실). 시간계열 성분만 per-GPU·hr 환산 대상(base_fee/storage는 별도). */
export interface PriceComponent {
  component_kind: ComponentKind
  amount: number
  currency: string
  unit: ComponentUnit
  gpu_count?: number | null
  tax_basis?: TaxBasis
  provenance?: string
}

/** DB(market_price_components) insert row 형태로 직렬화. observation_id는 저장부가 주입. */
export function toComponentRow(
  c: PriceComponent,
  fx: { rate: number | null; date: string | null; source: string | null },
): Record<string, unknown> {
  return {
    component_kind: c.component_kind,
    amount: c.amount,
    currency: c.currency,
    unit: c.unit,
    gpu_count: c.gpu_count ?? null,
    fx_rate: fx.rate,
    fx_rate_date: fx.date,
    fx_source: fx.source,
    tax_basis: c.tax_basis ?? 'unknown',
    provenance: c.provenance ?? null,
  }
}

const isHourPeriod = (u: ComponentUnit): u is HourPeriod =>
  u === 'minute' || u === 'hour' || u === 'day' || u === 'week' || u === 'month' || u === 'year'

/**
 * 시간계열 성분(usage/flat) → per-GPU·1시간당 KRW. base_fee/storage/용량단위는 시간축이 아니라 null.
 *   flat(월정액 번들)은 gpu_count로 나눠 1장당, usage(1장 종량)는 gpu_count=1 기본.
 */
export function componentToKrwPerGpuHour(c: PriceComponent, fx: FxKrwMap): number | null {
  if (!isHourPeriod(c.unit)) return null // per_gb·per_account은 시간환산 불가(별도 성분)
  const krw = amountToKrw(c.amount, c.currency, fx)
  if (krw == null) return null
  const hours = HOURS_PER_PERIOD[c.unit]
  const cnt = c.gpu_count && c.gpu_count > 0 ? c.gpu_count : 1
  return krw / hours / cnt
}
