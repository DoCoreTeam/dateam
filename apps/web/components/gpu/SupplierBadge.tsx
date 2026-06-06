'use client'

// 공용 공급사/경쟁사/자사 배지 (시장비교·가격표·재고 공통)
// docs 02 §3 — 표시 1벌로 통일해 수정 1곳에서 전파.

interface SupplierBadgeProps {
  name: string | null
  color?: string | null
  /** 'ours' = 우리 공급사(accent 보더), 'competitor' = 경쟁사(회색), 'self' = 자사(gcube) */
  kind?: 'ours' | 'competitor' | 'self'
  /** 공급사 미지정 강조 */
  unassigned?: boolean
}

export function SupplierBadge({ name, color, kind = 'ours', unassigned }: SupplierBadgeProps) {
  if (unassigned || !name) {
    return (
      <span style={{ fontSize: 12, color: 'var(--gpu-amber)', fontWeight: 600 }}>
        공급사 미지정
      </span>
    )
  }
  const isOurs = kind === 'ours' || kind === 'self'
  return (
    <span
      className="gpu-supplier-tag"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 12, fontWeight: 600,
        padding: '1px 7px', borderRadius: 6,
        border: isOurs ? '1px solid var(--gpu-accent, #5b5ef0)' : '1px solid var(--gpu-border, var(--color-border))',
        background: isOurs ? 'rgba(91,94,240,0.06)' : '#f9fafb',
        color: isOurs ? 'var(--gpu-accent, #5b5ef0)' : 'var(--gpu-ink, #374151)',
      }}
    >
      <span className="gpu-sdot" style={{ background: color ?? '#9ca3af', flexShrink: 0 }} />
      {name}
      {kind === 'self' && <span style={{ fontSize: 9, opacity: 0.7 }}>자사</span>}
      {kind === 'ours' && <span style={{ fontSize: 9, opacity: 0.7 }}>공급사</span>}
    </span>
  )
}
