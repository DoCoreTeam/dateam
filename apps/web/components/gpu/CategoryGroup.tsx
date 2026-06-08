'use client'

import { ChevronRight } from 'lucide-react'
import { TIER_META } from '@/lib/gpu/group'

// 공용 카테고리 헤더 (Tier / 모델) — 4개 메뉴 동일 표시 (docs 01 §3, 02 §3)
// 표시/접힘 동작을 1곳에서 통일 → 한 곳 수정으로 전 메뉴 반영.

export function TierHeader({
  tier, modelCount, itemCount, collapsed, onToggle,
}: {
  tier: number; modelCount: number; itemCount: number; collapsed: boolean; onToggle: () => void
}) {
  const meta = TIER_META[tier] ?? { label: `Tier ${tier}`, name: '', badge: 'gpu-badge-t2' }
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
        padding: '9px 12px', background: 'var(--surface-bg)', borderRadius: 8,
        border: 'var(--hairline) solid var(--gpu-border, var(--color-border))', userSelect: 'none',
      }}
    >
      <ChevronRight size={16} style={{ transform: collapsed ? 'none' : 'rotate(90deg)', transition: 'transform .15s', color: 'var(--gpu-muted)' }} />
      <strong style={{ fontSize: 13.5, color: 'var(--text)' }}>{meta.label}</strong>
      <span style={{ fontSize: 11.5, color: 'var(--gpu-muted)', marginLeft: 'auto' }}>
        {modelCount}개 모델 · {itemCount}개 구성
      </span>
    </div>
  )
}

export function ModelHeader({
  tier, model, itemCount, meta, collapsed, onToggle,
}: {
  tier: number; model: string; itemCount: number; meta?: string; collapsed: boolean; onToggle: () => void
}) {
  const tierMeta = TIER_META[tier] ?? { badge: 'gpu-badge-t2' }
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
        padding: '7px 12px 7px 26px', background: 'var(--surface-bg)', borderRadius: 7,
        border: 'var(--hairline) solid var(--surface-bg)', userSelect: 'none',
      }}
    >
      <ChevronRight size={14} style={{ transform: collapsed ? 'none' : 'rotate(90deg)', transition: 'transform .15s', color: 'var(--gpu-muted)' }} />
      <span className={`gpu-badge ${tierMeta.badge}`} style={{ fontSize: 9.5 }}>T{tier}</span>
      <strong style={{ fontSize: 13, color: 'var(--text)' }}>{model}</strong>
      <span style={{ fontSize: 11, color: 'var(--gpu-muted)', marginLeft: 'auto' }}>
        {itemCount}개 구성{meta ? ` · ${meta}` : ''}
      </span>
    </div>
  )
}
