// AI 구조화 관측 ↔ 기존 결정론 추출 결과 교차검증.
//   양쪽이 일치하면 자동확정 후보, 상충하면 조용히 한쪽을 고르지 않고 보류(conflict)해 화면에 노출한다.

import { observationToKrwPerGpuHour, type AiObservation } from './observation-contract.ts'
import type { FxKrwMap } from './normalize-money.ts'

export type Agreement = 'agree' | 'conflict' | 'ai_only' | 'det_only'

const AGREEMENT_TOLERANCE = 0.02 // 상대오차 2%

export interface DeterministicItem {
  model_name: string
  price_usd: number | null
}

export interface CrossCheckResult {
  model: string
  agreement: Agreement
  aiKrwPerGpuHour: number | null
  detKrwPerGpuHour: number | null
  relativeDiff: number | null
  reason: string
}

function detToKrwPerGpuHour(priceUsd: number | null, krwPerUsd: number): number | null {
  if (typeof priceUsd !== 'number' || !Number.isFinite(priceUsd) || priceUsd <= 0) return null
  if (!Number.isFinite(krwPerUsd) || krwPerUsd <= 0) return null
  return priceUsd * krwPerUsd
}

function relativeDiff(a: number, b: number): number {
  const base = Math.max(Math.abs(a), Math.abs(b))
  if (base === 0) return 0
  return Math.abs(a - b) / base
}

/**
 * AI 관측 목록 ↔ 결정론 추출 결과(모델명 기준) 교차검증.
 * - 양쪽 존재 & 상대오차 ≤2% → agree(자동확정 후보)
 * - 양쪽 존재 & 초과 → conflict(보류 — 조용히 한쪽 고르기 금지)
 * - AI만 → ai_only, 결정론만 → det_only
 * 모델명은 AI 관측의 catalog_match(있으면) 또는 model 원문으로 매칭한다.
 */
export function crossCheck(
  aiObs: AiObservation[],
  detItems: DeterministicItem[],
  krwPerUsd: number,
  fx: FxKrwMap,
): CrossCheckResult[] {
  const detByModel = new Map<string, DeterministicItem>()
  for (const item of detItems) {
    const key = item.model_name.trim().toLowerCase()
    if (key) detByModel.set(key, item)
  }

  const results: CrossCheckResult[] = []
  const matchedDetKeys = new Set<string>()

  for (const obs of aiObs) {
    const modelKey = (obs.catalog_match ?? obs.model).trim().toLowerCase()
    const detItem = detByModel.get(modelKey)
    const aiKrw = observationToKrwPerGpuHour(obs, fx)

    if (!detItem) {
      results.push({
        model: obs.catalog_match ?? obs.model,
        agreement: 'ai_only',
        aiKrwPerGpuHour: aiKrw,
        detKrwPerGpuHour: null,
        relativeDiff: null,
        reason: '결정론 추출 결과 없음 — AI만 발견한 관측(신규 후보)',
      })
      continue
    }

    matchedDetKeys.add(modelKey)
    const detKrw = detToKrwPerGpuHour(detItem.price_usd, krwPerUsd)

    if (aiKrw === null || detKrw === null) {
      results.push({
        model: obs.catalog_match ?? obs.model,
        agreement: 'ai_only',
        aiKrwPerGpuHour: aiKrw,
        detKrwPerGpuHour: detKrw,
        relativeDiff: null,
        reason: aiKrw === null
          ? 'AI 관측이 시간축 정규화 불가(per_gb/per_account) 또는 미지원 통화 — 비교 보류'
          : '결정론 값 없음/무효 — 비교 보류',
      })
      continue
    }

    const diff = relativeDiff(aiKrw, detKrw)
    if (diff <= AGREEMENT_TOLERANCE) {
      results.push({
        model: obs.catalog_match ?? obs.model,
        agreement: 'agree',
        aiKrwPerGpuHour: aiKrw,
        detKrwPerGpuHour: detKrw,
        relativeDiff: diff,
        reason: `AI·결정론 상대오차 ${(diff * 100).toFixed(2)}% ≤ 2% — 자동확정 후보`,
      })
    } else {
      results.push({
        model: obs.catalog_match ?? obs.model,
        agreement: 'conflict',
        aiKrwPerGpuHour: aiKrw,
        detKrwPerGpuHour: detKrw,
        relativeDiff: diff,
        reason: `AI·결정론 상대오차 ${(diff * 100).toFixed(2)}% > 2% — 보류(양쪽 값 모두 노출, 임의 선택 금지)`,
      })
    }
  }

  for (const item of detItems) {
    const key = item.model_name.trim().toLowerCase()
    if (!key || matchedDetKeys.has(key)) continue
    results.push({
      model: item.model_name,
      agreement: 'det_only',
      aiKrwPerGpuHour: null,
      detKrwPerGpuHour: detToKrwPerGpuHour(item.price_usd, krwPerUsd),
      relativeDiff: null,
      reason: 'AI 관측 없음 — 결정론만 발견(AI 미인식 사유 확인 필요)',
    })
  }

  return results
}
