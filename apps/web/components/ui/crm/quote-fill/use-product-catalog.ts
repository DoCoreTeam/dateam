'use client'

// 견적 줄에서 품목 고르기와 그 자리에서 만들기 — 편집 모달이 800줄에 닿아 떼어 냈다.
//
// 고르면 단가 단위 세율에 더해 **그날 정상가와 출처**가 줄에 붙는다(가격 기준).
// 확인 전 가격이면 출처가 「확인 전 가격」이다 — 자동 채움 기준으로 안 쓰고 사람이 고른 것만 들어간다.

import { useCallback, useRef } from 'react'
import type { RecordOption, RecordSearch } from '@/components/ui/RecordPicker'
import type { ProductJson, QuoteDraft, QuoteLineDraft } from '../quote-draft-shape'

/** 고르는 목록에 실리는 모양 — SKU 는 이름이 겹칠 때 구분해 주는 보조 정보다 */
export function toOption(p: ProductJson): RecordOption {
  return { id: p.id, name: p.name, hint: p.sku || undefined }
}

export function useProductCatalog(draft: QuoteDraft, setLine: (i: number, patch: Partial<QuoteLineDraft>) => void) {
  const catalog = useRef(new Map<string, ProductJson>())

  /** 신원이 고정돼야 한다 — 고르는 모달의 effect 의존성이라 렌더마다 새 함수면 검색이 끝없이 돈다 */
  const searchProducts = useCallback<RecordSearch>(async (query, signal) => {
    const res = await fetch(`/api/crm/products?q=${encodeURIComponent(query)}`, { signal })
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error?.message ?? '품목을 불러오지 못했습니다.')
    const items = (body.items ?? []) as ProductJson[]
    items.forEach((p) => catalog.current.set(p.id, p))
    return items.map(toOption)
  }, [])

  /** 고른 품목의 단가 단위 세율, 그날 정상가와 출처를 그 줄에 옮긴다 */
  const pickProduct = (i: number, opt: RecordOption | null) => {
    if (!opt) { setLine(i, { productId: null }); return }
    const p = catalog.current.get(opt.id)
    const patch: Partial<QuoteLineDraft> = { productId: opt.id, name: opt.name }
    // 단가 0 은 "아직 안 정했다"는 뜻이다 — 사람이 친 금액을 0 으로 덮으면 그게 손해다
    if (p && p.unitPriceMinor !== '0') {
      patch.unitPriceMinor = p.unitPriceMinor
      patch.listPriceMinor = p.unitPriceMinor
      patch.priceSource = 'LIST'
      patch.provenance = { unitPrice: { source: p.needsReview ? 'UNVERIFIED' : 'PRICEBOOK', note: p.needsReview ? '확인 전 가격' : null } }
      patch.lockedFields = []
    }
    if (p?.unit) patch.unit = p.unit
    if (p?.taxRate) patch.taxRate = p.taxRate
    if (p?.billing === 'ANNUAL') patch.billing = 'ANNUAL'
    setLine(i, patch)
  }

  /** 카탈로그에 없으면 그 자리에서 만든다 — 지금 친 단가 단위 세율을 함께 실어 보낸다 */
  const createProduct = async (i: number, name: string): Promise<RecordOption | null> => {
    const line = draft.lines[i]
    const res = await fetch('/api/crm/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        currency: draft.currency,
        unitPriceMinor: line?.unitPriceMinor || '0',
        unit: line?.unit || null,
        taxRate: line?.taxRate || '10',
      }),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error?.message ?? '품목을 만들지 못했습니다.')
    const made = body as ProductJson
    catalog.current.set(made.id, made)
    return toOption(made)
  }

  return { searchProducts, pickProduct, createProduct }
}
