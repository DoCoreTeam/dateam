'use client'

import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react'
import type { UnassignedLine } from '@/lib/ai-chat/grouping/types'

interface Props {
  unassignedLines: UnassignedLine[]
}

/**
 * ★ P0 신뢰 장치 — 미귀속 원문 표시. 이 기능의 신뢰를 지탱하는 유일한 증거다.
 * 0줄이면 성공 배지, 1줄 이상이면 경고 배지 + 원문 목록을 노출한다(조용한 드롭 금지).
 * docs/2026-07-20-.../01-architecture.md §6 참조.
 */
export default function UnassignedBadge({ unassignedLines }: Props) {
  const [open, setOpen] = useState(false)

  if (unassignedLines.length === 0) {
    return (
      <div
        className="card"
        style={{
          padding: 'var(--space-3) var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          borderColor: 'var(--success-border)',
          background: 'var(--success-bg)',
        }}
      >
        <CheckCircle2 size={16} color="var(--success)" />
        <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--success)' }}>
          미귀속 원문 0줄
        </span>
      </div>
    )
  }

  return (
    <div
      className="card"
      style={{
        padding: 0,
        overflow: 'hidden',
        borderColor: 'var(--warning-border)',
        background: 'var(--warning-bg)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-3) var(--space-4)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          minHeight: 44,
        }}
      >
        {open ? <ChevronDown size={16} color="var(--warning)" /> : <ChevronRight size={16} color="var(--warning)" />}
        <AlertTriangle size={16} color="var(--warning)" />
        <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--warning)' }}>
          미귀속 원문 {unassignedLines.length}줄 — 어느 그룹에도 들어가지 않았습니다
        </span>
      </button>
      {open && (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 'var(--space-4)',
            paddingTop: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
            borderTop: 'var(--hairline) solid var(--warning-border)',
          }}
        >
          {unassignedLines.map((l) => (
            <li
              key={l.lineNo}
              style={{
                display: 'flex',
                gap: 'var(--space-2)',
                fontSize: 'var(--fs-sm)',
                fontFamily: 'var(--font-mono, monospace)',
              }}
            >
              <span style={{ flexShrink: 0, color: 'var(--text-faint)' }}>{l.lineNo + 1}:</span>
              <span style={{ color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{l.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
