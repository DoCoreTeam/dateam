'use client'

// components/crm/MeetingModeToggle.tsx — 헤더의 회의 모드 스위치
//
// 자리는 헤더다. 회의 중에 켜고 끄는 것이라 **어느 CRM 화면에서든 같은 자리**에 있어야 한다.
// `AttentionBell` 옆 — 둘 다 "지금 이 순간"에 관한 것이다.

import { Eye, EyeOff } from 'lucide-react'
import { useMeetingMode } from '@/lib/crm/ui/meeting-mode'
import styles from './sensitive.module.css'

export default function MeetingModeToggle() {
  const { on, toggle } = useMeetingMode()
  return (
    <button
      type="button"
      className={styles.toggle}
      data-on={on ? '1' : '0'}
      onClick={toggle}
      aria-pressed={on}
      title={on
        ? '회의 모드 — 금액·확률을 가리는 중입니다. 누르면 다시 보입니다'
        : '고객 앞에서 화면을 열 때 켜세요. 금액·확률을 가립니다'}
    >
      {on ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
      <span className={styles.label}>회의 모드</span>
    </button>
  )
}
