'use client'

// components/pricing/gpu/cockpit/CandidateCell.tsx
// 판매가 후보(candidate_price_krw) + "이 값으로 지정" 버튼 → strategic-price PATCH 승격

import { useState, useCallback } from 'react'
import { ArrowRight } from 'lucide-react'
import { fmtKRW } from '@/lib/gpu/format-price'
import type { CockpitProduct } from './types'

interface CandidateCellProps {
  product: CockpitProduct
  isAdmin: boolean
  onPromoted: () => void
}

export function CandidateCell({ product, isAdmin, onPromoted }: CandidateCellProps) {
  const [promoting, setPromoting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const candidate = product.candidate_price_krw

  const promote = useCallback(async () => {
    if (!candidate || promoting) return
    setPromoting(true)
    setError(null)
    try {
      const res = await fetch('/api/pricing/gpu/strategic-price', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: product.id, strategic_price_krw: candidate }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error ?? '지정 실패')
      }
      onPromoted()
    } catch (err) {
      setError(err instanceof Error ? err.message : '지정 실패')
    } finally {
      setPromoting(false)
    }
  }, [candidate, product.id, promoting, onPromoted])

  if (candidate == null) {
    return <span className="cockpit-price-sub">—</span>
  }

  return (
    <div className="cockpit-candidate-cell">
      <span className="cockpit-price">{fmtKRW(candidate)}</span>
      {product.margin_pct != null && (
        <span className="cockpit-price-sub cockpit-margin-hint">
          마진 {product.margin_pct.toFixed(1)}%
        </span>
      )}
      {isAdmin && (
        <button
          className="cockpit-promote-btn"
          onClick={promote}
          disabled={promoting}
          aria-label="이 값으로 우리 판매가 지정"
          title="판매가 후보를 우리 판매가로 지정"
        >
          {promoting ? (
            <span className="cockpit-saving-dot">…</span>
          ) : (
            <>
              <ArrowRight size={11} />
              <span>지정</span>
            </>
          )}
        </button>
      )}
      {error && (
        <span className="cockpit-error-hint" role="alert" aria-live="polite">
          {error}
        </span>
      )}
    </div>
  )
}
