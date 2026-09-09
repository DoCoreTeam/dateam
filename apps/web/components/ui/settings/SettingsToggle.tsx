'use client'

// 켬 끔 토글 — 두 값뿐인 설정을 텍스트 입력이나 드롭다운으로 받지 않는다.
//
// 누르는 자리는 손가락이 닿는 크기(44px)를 지킨다. 상태는 aria-pressed 로 말한다 —
// 색만으로 켬 끔을 말하면 색을 못 보는 사람에게는 아무 말도 하지 않은 것이다.

import type { ReactNode } from 'react'

interface Props {
  on: boolean
  onToggle: (next: boolean) => void
  /** 토글 옆 설명. 무엇이 켜지는지 */
  label: ReactNode
  disabled?: boolean
}

export default function SettingsToggle({ on, onToggle, label, disabled }: Props) {
  return (
    <button
      type="button"
      className={`settings-toggle${on ? ' is-on' : ''}`}
      aria-pressed={on}
      disabled={disabled}
      onClick={() => onToggle(!on)}
    >
      <span className="settings-toggle-knob" aria-hidden="true" />
      <span className="settings-toggle-label">{label}</span>
    </button>
  )
}
