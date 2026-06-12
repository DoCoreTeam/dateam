'use client'

// 통합 표 — 보기 전환 세그먼트 (저장된 보기 복원/영속 포함)
// 보기 = 컬럼 프리셋 교체(데이터 재요청 없음). VIEW_PRESETS(SSOT)에서 라벨/순서.

import { useEffect } from 'react'
import { VIEW_ORDER, VIEW_PRESETS, DEFAULT_VIEW, isValidViewId } from '@/lib/gpu/unified-views'
import type { GpuViewId } from '@/lib/gpu/unified-views'

const STORAGE_KEY = 'gpu:unified:view'

interface ViewSwitcherProps {
  value: GpuViewId
  onChange: (view: GpuViewId) => void
}

/** 저장된 보기 복원(localStorage). SSR 안전. */
export function restoreSavedView(): GpuViewId {
  if (typeof window === 'undefined') return DEFAULT_VIEW
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (isValidViewId(saved)) return saved
  } catch {
    /* noop */
  }
  return DEFAULT_VIEW
}

export default function ViewSwitcher({ value, onChange }: ViewSwitcherProps) {
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, value)
    } catch {
      /* noop */
    }
  }, [value])

  return (
    <div className="gpu-uview-seg" role="tablist" aria-label="보기 전환">
      {VIEW_ORDER.map((id: GpuViewId) => {
        const preset = VIEW_PRESETS[id]
        const active = id === value
        return (
          <button
            key={id}
            role="tab"
            aria-selected={active}
            title={preset.hint}
            className={`gpu-uview-seg-btn${active ? ' gpu-uview-seg-btn--on' : ''}`}
            onClick={() => onChange(id)}
          >
            {preset.label}
          </button>
        )
      })}
    </div>
  )
}
