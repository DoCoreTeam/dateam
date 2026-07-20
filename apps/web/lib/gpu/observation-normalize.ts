// 관측 원본(금액·통화·기간·장수) → per-GPU·1시간당 KRW 결정론 정규화 SSOT (확정 기획 P3).
//   원칙: 환산·나눗셈은 100% 코드(AI 금지). 원본에서만 계산(동결 KRW 재환산 금지 — 이중환산 방지).
//   이원화는 호출부가 fx맵으로 결정: 표시=최신환율맵 / 판가·이력=관측시점 스냅샷맵({currency: 저장된 fx_rate}).
import { amountToKrw, krwToCurrency, type FxKrwMap } from './normalize-money.ts'
import { HOURS_PER_MINUTE, HOURS_PER_HOUR, HOURS_PER_DAY, HOURS_PER_MONTH, HOURS_PER_YEAR } from './hours.ts'

export type PricingUnit = 'minute' | 'hour' | 'day' | 'month' | 'year'

// 기간 → 시간 (월=720h SSOT=hours.ts, 720/730 이원화 해소). 분 포함.
const HOURS_PER_UNIT: Record<PricingUnit, number> = {
  minute: HOURS_PER_MINUTE, hour: HOURS_PER_HOUR, day: HOURS_PER_DAY, month: HOURS_PER_MONTH, year: HOURS_PER_YEAR,
}

export interface PriceObservation {
  amount: number          // 관측 금액(currency 기준). 이 금액이 (기간 × gpu_count) 전체를 포함.
  currency: string        // ISO4217
  pricing_unit: PricingUnit
  gpu_count: number       // 이 금액이 포함하는 GPU 장수(번들 8장 등). per-GPU 환산에 필요.
}

export interface NormalizedPrice {
  krw_per_gpu_hour: number // per-GPU·1시간당 원화(비교 표준 축)
  fx_applied: number       // 적용 환율(1 currency = fx_applied KRW). KRW는 1.
}

/** 관측 원본 → per-GPU·hr KRW. 환율 미보유·불량 입력이면 null(보류). */
export function toKrwPerGpuHour(obs: PriceObservation, fx: FxKrwMap): NormalizedPrice | null {
  if (!obs || typeof obs.amount !== 'number' || obs.amount <= 0) return null
  const hours = HOURS_PER_UNIT[obs.pricing_unit]
  if (!hours) return null
  const count = obs.gpu_count
  if (typeof count !== 'number' || count < 1) return null
  const totalKrw = amountToKrw(obs.amount, obs.currency, fx) // 기간×장수 전체 KRW
  if (totalKrw == null) return null
  const cur = (obs.currency ?? '').toUpperCase()
  const fxApplied = cur === 'KRW' ? 1 : fx[cur]
  return { krw_per_gpu_hour: totalKrw / hours / count, fx_applied: fxApplied }
}

/** per-GPU·hr USD 보조 표시(콕핏 USD 뷰). KRW 기준값을 fx맵으로 교차환산. */
export function krwPerGpuHourToUsd(krwPerGpuHour: number, fx: FxKrwMap): number | null {
  return krwToCurrency(krwPerGpuHour, 'USD', fx)
}
