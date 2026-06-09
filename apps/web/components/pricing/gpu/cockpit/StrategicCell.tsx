'use client'

// components/pricing/gpu/cockpit/StrategicCell.tsx
// 우리 판매가(포지셔닝 가격) 인라인 편집 셀
// 기존 PriceCockpitTab의 StrategicCell을 분리 + 개선

import { useState, useRef, useCallback } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import { fmtKRW } from '@/lib/gpu/format-price'
import type { CockpitProduct } from './types'

interface StrategicCellProps {
  product: CockpitProduct
  isAdmin: boolean
  onSaved: () => void
}

export function StrategicCell({ product, isAdmin, onSaved }: StrategicCellProps) {
  const [editing, setEditing] = useState(false)
  const [inputVal, setInputVal] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = useCallback(() => {
    setInputVal(product.strategic_price_krw != null ? String(product.strategic_price_krw) : '')
    setSaveError(null)
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [product.strategic_price_krw])

  const cancel = useCallback(() => {
    setEditing(false)
    setInputVal('')
    setSaveError(null)
  }, [])

  const save = useCallback(async () => {
    if (saving) return
    const trimmed = inputVal.trim()
    const digitsOnly = trimmed.replace(/[^0-9]/g, '')
    const priceKrw = trimmed === '' ? null : Number(digitsOnly)
    if (trimmed !== '' && (!priceKrw || priceKrw <= 0)) {
      setSaveError('0보다 큰 금액을 입력하세요')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/pricing/gpu/strategic-price', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: product.id, strategic_price_krw: priceKrw }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error ?? '저장 실패')
      }
      setEditing(false)
      setSaveError(null)
      onSaved()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }, [inputVal, product.id, saving, onSaved])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') save()
      if (e.key === 'Escape') cancel()
    },
    [save, cancel],
  )

  const displayPrice = product.is_strategic_set ? product.strategic_price_krw : product.strategic_krw

  if (!isAdmin) {
    return (
      <div className="cockpit-strategic-cell">
        {product.is_strategic_set ? (
          <span className="cockpit-price--strategic">{fmtKRW(product.strategic_price_krw)}</span>
        ) : (
          <span className="cockpit-price--auto" title="우리 판매가 미설정 — 자동 마진가 적용 중">
            {fmtKRW(product.auto_margin_krw ?? product.strategic_krw)}
          </span>
        )}
      </div>
    )
  }

  if (editing) {
    return (
      <div className="cockpit-strategic-cell">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          className="cockpit-inline-input"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="금액(원)"
          aria-label="우리 판매가 입력"
        />
        <div className="cockpit-inline-actions">
          <button
            className="cockpit-edit-btn"
            onClick={save}
            disabled={saving}
            aria-label="저장"
            title="저장 (Enter)"
          >
            {saving ? <span className="cockpit-saving-dot">…</span> : <Check size={12} />}
          </button>
          <button
            className="cockpit-edit-btn"
            onClick={cancel}
            aria-label="취소"
            title="취소 (Esc)"
          >
            <X size={12} />
          </button>
        </div>
        {saveError && (
          <span className="cockpit-error-hint" role="alert" aria-live="polite">
            {saveError}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="cockpit-strategic-cell">
      {product.is_strategic_set ? (
        <span
          className="cockpit-price--strategic"
          title="직접 설정한 포지셔닝 가격"
        >
          {fmtKRW(displayPrice)}
        </span>
      ) : (
        <span
          className="cockpit-price--auto"
          title="우리 판매가 미설정 — 자동 마진가 적용 중"
        >
          {fmtKRW(displayPrice)}
        </span>
      )}
      <button
        className="cockpit-edit-btn"
        onClick={startEdit}
        aria-label="우리 판매가 편집"
        title={product.is_strategic_set ? '우리 판매가 수정 / 해제' : '우리 판매가 직접 지정'}
      >
        <Pencil size={12} />
      </button>
    </div>
  )
}
