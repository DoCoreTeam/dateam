'use client'

// 다중선택 목록의 "N개 선택됨 + 일괄 액션" 바 — 공용(SSOT).
// useRowSelection과 짝으로 쓴다. 선택이 0이면 렌더하지 않는다(빈 바가 자리만 차지하지 않도록).
// 스타일은 globals.css `.bulk-bar` — 화면마다 인라인 재구현 금지.

import type { ReactNode } from 'react'

interface BulkActionBarProps {
  count: number
  onClear: () => void
  /** 오른쪽 액션 버튼들(선택 삭제 / 선택 복구 등) */
  children: ReactNode
  /** 세는 단위 — 기본 "개" */
  unit?: string
}

export default function BulkActionBar({ count, onClear, children, unit = '개' }: BulkActionBarProps) {
  if (count === 0) return null
  return (
    <div className="bulk-bar" role="region" aria-label="선택 항목 일괄 작업">
      <span className="bulk-bar-count" aria-live="polite">
        {count}
        {unit} 선택됨
      </span>
      <button type="button" className="bulk-bar-clear" onClick={onClear}>
        선택 해제
      </button>
      <div className="bulk-bar-actions">{children}</div>
    </div>
  )
}
