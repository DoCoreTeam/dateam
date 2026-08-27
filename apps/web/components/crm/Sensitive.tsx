'use client'

// components/crm/Sensitive.tsx — 회의 모드에서 가릴 것
//
// **왜 부품인가**: 화면마다 `if (meetingMode) return '●●●'` 를 적으면
// 새 화면이 생길 때마다 빠뜨린다. 가릴 것을 **감싸는 것**으로 두면 빠뜨림이 보인다.
//
// **가리는 것이지 지우는 것이 아니다.** 자리는 그대로 두고 값만 덮는다 —
// 지우면 줄이 접혀 화면이 흔들리고, 고객 쪽에서 "뭔가 사라졌다"가 더 눈에 띈다.

import type { ReactNode } from 'react'
import { useMeetingMode } from '@/lib/crm/ui/meeting-mode'
import styles from './sensitive.module.css'

interface Props {
  children: ReactNode
  /** 가렸을 때 대신 보일 것. 기본은 점 넷 */
  placeholder?: string
  /** 무엇을 가렸는지 — 스크린리더와 툴팁이 읽는다 */
  label?: string
}

export default function Sensitive({ children, placeholder = '●●●●', label = '회의 모드에서 가려진 값' }: Props) {
  const { on } = useMeetingMode()
  if (!on) return <>{children}</>
  return (
    <span className={styles.masked} title={label} aria-label={label}>
      {placeholder}
    </span>
  )
}

/**
 * 문장 안에 섞인 값을 가린다.
 *
 * `예상 3억 · 근거 부족 1억` 처럼 **문장에 녹아 있는 금액**은 컴포넌트로 감쌀 수 없다.
 * 그런 자리는 값을 먼저 가리고 문장에 넣는다 — 표시는 `Sensitive` 와 같게 둔다.
 */
export function useMaskAmount(): (text: string) => string {
  const { on } = useMeetingMode()
  return (text: string) => (on && text ? '●●●●' : text)
}
