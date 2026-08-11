'use client'

// 목록 ↔ 휴지통 전환 세그먼트 토글 — 공용(SSOT).
//
// 왜 체크박스가 아니라 토글인가: 휴지통은 "옵션을 켠다"가 아니라 **보고 있는 목록 자체를 바꾸는** 전환이다.
// 체크박스로 두면 (a) 현재 어떤 목록을 보는지 한눈에 안 보이고 (b) 필터 체크박스들과 섞여
// "삭제된 것도 함께 보기"로 오해된다(실제로는 삭제된 것만 보인다). → 상호배타 세그먼트로 고정.
// 스타일은 globals.css `.seg-toggle`.

import { List, Trash2 } from 'lucide-react'

interface TrashToggleProps {
  /** true면 휴지통 보기 */
  value: boolean
  onChange: (showDeleted: boolean) => void
  /** 활성 목록 쪽 라벨 — 기본 "목록" */
  activeLabel?: string
}

export default function TrashToggle({ value, onChange, activeLabel = '목록' }: TrashToggleProps) {
  return (
    <div className="seg-toggle" role="group" aria-label="목록/휴지통 전환">
      <button
        type="button"
        className={`seg-toggle-btn${value ? '' : ' is-active'}`}
        aria-pressed={!value}
        onClick={() => onChange(false)}
        data-testid="trash-toggle-active"
      >
        <List size={14} />
        {activeLabel}
      </button>
      <button
        type="button"
        className={`seg-toggle-btn${value ? ' is-active' : ''}`}
        aria-pressed={value}
        onClick={() => onChange(true)}
        data-testid="trash-toggle-deleted"
      >
        <Trash2 size={14} />
        휴지통
      </button>
    </div>
  )
}
