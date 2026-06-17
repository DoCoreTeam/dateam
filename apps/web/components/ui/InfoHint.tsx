'use client'

import { HelpCircle } from 'lucide-react'

interface InfoHintProps {
  /** 툴팁/스크린리더로 노출할 설명 문장 */
  text: string
  /** 아이콘 크기 (기본 14) */
  size?: number
}

/**
 * 공용 도움말 힌트 — ❓ 아이콘에 hover/포커스 시 native title 툴팁 + 스크린리더 라벨.
 * 디자인 정책 §3-1("설명문 → 툴팁")의 SSOT. 화면마다 인라인 ❓ 복붙 금지하고 이 컴포넌트 재사용.
 * 모바일은 title 툴팁이 약하므로, 핵심 기능 설명은 가시 텍스트(부제)와 병행할 것.
 */
export default function InfoHint({ text, size = 14 }: InfoHintProps) {
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        color: 'var(--text-faint)',
        cursor: 'help',
        flexShrink: 0,
      }}
    >
      <HelpCircle size={size} aria-hidden />
    </span>
  )
}
