'use client'

import type { ReactNode } from 'react'

/**
 * 공용 빈 상태 컴포넌트 — 데이터가 0건일 때 "빈 화면"으로 끝내지 않고,
 * 무엇을 할 수 있는지(만들기/가져오기 동선)를 안내한다. (설계 헌법 제2조 "없으면 만들게")
 *
 * 화면마다 빈 상태를 제각각 그리지 말고 이 컴포넌트를 재사용한다.
 */
export interface EmptyStateProps {
  /** 굵은 제목 한 줄 (무엇이 없는지) */
  title: string
  /** 안내 문장 (어떻게 채우는지) — 쉬운 말로 */
  description?: ReactNode
  /** 아이콘(선택) */
  icon?: ReactNode
  /** 주 행동 버튼 라벨 (있으면 primary 액션 노출) */
  actionLabel?: string
  /** 주 행동 클릭 */
  onAction?: () => void
}

export default function EmptyState({ title, description, icon, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        padding: '36px 16px', textAlign: 'center',
        border: 'var(--hairline) dashed var(--border-color)', borderRadius: 12,
        color: 'var(--text-muted)',
      }}
    >
      {icon && <div style={{ color: 'var(--text-faint)' }}>{icon}</div>}
      <p style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)' }}>{title}</p>
      {description && <p style={{ margin: 0, fontSize: 'var(--fs-sm)', maxWidth: 440, lineHeight: 1.6 }}>{description}</p>}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          style={{
            marginTop: 4, padding: '8px 16px', borderRadius: 8,
            border: 'var(--border-w-2) solid var(--brand)', background: 'var(--brand)', color: '#fff',
            fontWeight: 600, fontSize: 'var(--fs-sm)', cursor: 'pointer',
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
