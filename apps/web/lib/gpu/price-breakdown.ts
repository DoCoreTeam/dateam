// 단가 산출 근거 SSOT — "원본가 → 통화환산 → 시간환산 → 장수환산 → USD/GPU·hr"의
// 각 단계를 사람이 읽는 step 목록으로 산출. 환산 산술은 normalize-money(SSOT) 재사용(복붙 금지).
// 검토대기 화면이 "이 3.17이 어떻게 나왔는지"를 보여주기 위한 표시 데이터.

import {
  resolveCurrency,
  resolvePeriod,
  periodToHours,
  toUsdPerGpuHour,
  type Period,
} from './normalize-money.ts'

export interface BreakdownStep {
  label: string
  detail?: string
  value: string
}

export interface PriceBreakdown {
  ok: boolean
  reason?: string
  /** SSOT(720h·주입 매매기준율) 기준 정합 단가 — 표시·정합검증용 */
  usdPerGpuHour?: number
  steps: BreakdownStep[]
}

export interface BreakdownInput {
  originalPrice: number | null | undefined
  /** 통화 토큰 또는 ISO ('KRW','원','$' 등). 없으면 originalUnit에서 추론 */
  originalCurrency?: string | null
  /** 'KRW/month','month','/hr' 등 — 기간·통화 토큰 추출원 */
  originalUnit?: string | null
  gpuCount?: number | null
  /** 1 USD = krwPerUsd KRW (org_content 매매기준율 주입) */
  krwPerUsd: number
}

const PERIOD_KO: Record<Period, string> = { hour: '시간', day: '일', month: '월', year: '년' }

function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('ko-KR', { maximumFractionDigits: digits })
}

/**
 * 단가 산출 근거 산출. 통화/기간/장수가 비KRW·미지이면 가능한 단계까지만 표시하고 ok:false.
 * 성공 시 usdPerGpuHour는 normalize-money SSOT 결과와 동일.
 */
export function buildPriceBreakdown(input: BreakdownInput): PriceBreakdown {
  const { originalPrice, originalCurrency, originalUnit, krwPerUsd } = input
  const steps: BreakdownStep[] = []

  if (!Number.isFinite(originalPrice as number) || (originalPrice as number) <= 0) {
    return { ok: false, reason: '원본 금액 없음', steps }
  }
  const amount = originalPrice as number
  const currency = resolveCurrency(originalCurrency) ?? resolveCurrency(originalUnit)
  const period: Period = resolvePeriod(originalUnit) ?? 'hour'
  const gpuCount = typeof input.gpuCount === 'number' && input.gpuCount > 0 ? input.gpuCount : 1

  // 1) 원본
  steps.push({
    label: '원본',
    value: `${fmt(amount, 0)} ${currency ?? originalCurrency ?? ''} / ${PERIOD_KO[period]}${gpuCount > 1 ? ` (${gpuCount}장)` : ''}`.trim(),
  })

  if (!currency) {
    return { ok: false, reason: '통화를 인식할 수 없음 (수동 환산 필요)', steps }
  }
  if (!(krwPerUsd > 0)) {
    return { ok: false, reason: '환율 미주입', steps }
  }
  if (currency !== 'KRW' && currency !== 'USD') {
    return { ok: false, reason: `${currency} 자동 환산 미지원 (KRW/USD만)`, steps }
  }

  // 2) 통화 → USD
  const usdTotal = currency === 'USD' ? amount : amount / krwPerUsd
  if (currency !== 'USD') {
    steps.push({
      label: '통화 환산',
      detail: `÷ ${fmt(krwPerUsd, 0)} (매매기준율)`,
      value: `${fmt(usdTotal)} USD / ${PERIOD_KO[period]}`,
    })
  }

  // 3) 기간 → 시간당
  const hours = periodToHours(period)
  const perHour = usdTotal / hours
  if (period !== 'hour') {
    steps.push({
      label: '시간 환산',
      detail: `÷ ${fmt(hours, 0)} (${PERIOD_KO[period]} ${hours}시간)`,
      value: `${fmt(perHour, 4)} USD / 시간`,
    })
  }

  // 4) 장수 → 1장당
  const perGpuHour = perHour / gpuCount
  if (gpuCount > 1) {
    steps.push({
      label: '장수 환산',
      detail: `÷ ${gpuCount}장`,
      value: `${fmt(perGpuHour, 4)} USD / GPU·시간`,
    })
  }

  // SSOT 재계산(정합 보장) — 위 산술과 동일해야 함
  let ssot: number
  try {
    ssot = toUsdPerGpuHour({ amount, currency, period, gpuCount, krwPerUsd })
  } catch {
    ssot = perGpuHour
  }

  steps.push({
    label: '정합 단가',
    detail: 'GPU 1장·1시간',
    value: `${fmt(ssot, 4)} USD/hr`,
  })

  return { ok: true, usdPerGpuHour: ssot, steps }
}

export interface ConfirmUnitPriceInput {
  /** AI가 환산해 준 1장·시간당 USD(하드코딩 환율 의심값) */
  aiUnitPriceUsd: number
  originalPrice: number | null | undefined
  originalCurrency?: string | null
  originalUnit?: string | null
  /** 확정 시 정규화된 GPU 장수(저장되는 gpu_count와 동일해야 함) */
  gpuCount: number
  krwPerUsd: number
  /** SSOT 재계산이 불가할 때 사용할 폴백(기존 toPerGpuPrice 결과) */
  fallbackPerGpu: number
}

export interface ConfirmUnitPriceResult {
  value: number
  recomputed: boolean
  reason: string
}

/**
 * 확정 시 저장할 1장·시간당 USD 단가 결정 — 환산 정합성 버그 교정 SSOT.
 * 원본가·통화·기간이 있고 "실제 환산(비USD 또는 비시간당)"이 필요한 경우에 한해
 * 주입 매매기준율로 결정론 재계산한다(AI의 하드코딩 환율값 대신). 그 외엔 폴백 유지(회귀 0).
 */
export function resolveConfirmUnitPrice(input: ConfirmUnitPriceInput): ConfirmUnitPriceResult {
  const { originalPrice, originalCurrency, originalUnit, gpuCount, krwPerUsd, fallbackPerGpu } = input
  if (!Number.isFinite(originalPrice as number) || (originalPrice as number) <= 0) {
    return { value: fallbackPerGpu, recomputed: false, reason: '원본가 없음 — AI 값 유지' }
  }
  const currency = resolveCurrency(originalCurrency) ?? resolveCurrency(originalUnit)
  const period: Period = resolvePeriod(originalUnit) ?? 'hour'
  if (!currency || (currency !== 'KRW' && currency !== 'USD')) {
    return { value: fallbackPerGpu, recomputed: false, reason: '통화 미지원 — AI 값 유지' }
  }
  if (!(krwPerUsd > 0)) {
    return { value: fallbackPerGpu, recomputed: false, reason: '환율 미주입 — AI 값 유지' }
  }
  // 환산이 필요 없는 경우(이미 USD·시간당)는 AI 값과 동일하므로 폴백 유지
  if (currency === 'USD' && period === 'hour') {
    return { value: fallbackPerGpu, recomputed: false, reason: '환산 불요(USD·시간당) — AI 값 유지' }
  }
  const gc = gpuCount > 0 ? gpuCount : 1
  try {
    const ssot = toUsdPerGpuHour({ amount: originalPrice as number, currency, period, gpuCount: gc, krwPerUsd })
    return { value: ssot, recomputed: true, reason: `SSOT 재계산(${currency}/${period}, 환율 ${krwPerUsd})` }
  } catch {
    return { value: fallbackPerGpu, recomputed: false, reason: '재계산 실패 — AI 값 유지' }
  }
}
