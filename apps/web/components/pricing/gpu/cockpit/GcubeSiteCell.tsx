'use client'

// components/pricing/gpu/cockpit/GcubeSiteCell.tsx
// gcube 사이트 게시 가격 인라인 편집 셀 + gcube 반영 상태 뱃지
// quotes PATCH (gcube_site_quote_id 기준)

import { useState, useRef, useCallback } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import { fmtKRW } from '@/lib/gpu/format-price'
import type { CockpitProduct } from './types'
import type { GcubeCheckItem } from '@/app/api/pricing/gpu/gcube-check/route'
import { GcubeSyncBadge } from './GcubeSyncBadge'

interface GcubeSiteCellProps {
  product: CockpitProduct
  isAdmin: boolean
  onSaved: () => void
  /** gcube-check API에서 병합된 이 product의 반영 상태 */
  syncItem?: GcubeCheckItem
}

export function GcubeSiteCell({ product, isAdmin, onSaved, syncItem }: GcubeSiteCellProps) {
  const [editing, setEditing] = useState(false)
  const [inputVal, setInputVal] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const price = product.gcube_site_price_krw

  const startEdit = useCallback(() => {
    setInputVal(price != null ? String(price) : '')
    setSaveError(null)
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [price])

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
    if (!product.gcube_site_quote_id) {
      setSaveError('등록된 gcube 사이트 견적이 없습니다')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/pricing/gpu/quotes/${product.gcube_site_quote_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_price_krw: priceKrw }),
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
  }, [inputVal, product.gcube_site_quote_id, saving, onSaved])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') save()
      if (e.key === 'Escape') cancel()
    },
    [save, cancel],
  )

  if (!isAdmin) {
    return (
      <div className="cockpit-gcube-cell">
        {price != null ? (
          <span className="cockpit-price cockpit-price--gcube">{fmtKRW(price)}</span>
        ) : (
          <span className="cockpit-price-sub">미등록</span>
        )}
        <GcubeSyncBadge item={syncItem} />
      </div>
    )
  }

  if (editing) {
    return (
      <div className="cockpit-gcube-cell">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          className="cockpit-inline-input"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="금액(원)"
          aria-label="gcube 사이트 가격 입력"
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
    <div className="cockpit-gcube-cell">
      {price != null ? (
        <span className="cockpit-price cockpit-price--gcube">{fmtKRW(price)}</span>
      ) : (
        <span className="cockpit-price-sub">미등록</span>
      )}
      {isAdmin && (
        <button
          className="cockpit-edit-btn"
          onClick={startEdit}
          aria-label="gcube 사이트 가격 편집"
          title="gcube 사이트 게시 가격 수정"
        >
          <Pencil size={12} />
        </button>
      )}
      <GcubeSyncBadge item={syncItem} />
    </div>
  )
}
