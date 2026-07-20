'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Group } from '@/lib/ai-chat/grouping/types'

interface Props {
  groups: Group[]
}

function lineCount(text: string): number {
  if (!text) return 0
  return text.split('\n').length
}

/** 그룹 접힘 리스트 — 기본 접힘, 펼치면 원문 슬라이스 그대로 표시(재작성 없음, §B). */
export default function GroupList({ groups }: Props) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (groups.length === 0) {
    return (
      <div className="card" style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
        인식된 그룹이 없습니다.
      </div>
    )
  }

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {groups.map((g, idx) => {
        const isOpen = openIds.has(g.id)
        return (
          <li key={g.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => toggle(g.id)}
              aria-expanded={isOpen}
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
                color: 'var(--text)',
              }}
            >
              {isOpen ? <ChevronDown size={16} color="var(--text-muted)" /> : <ChevronRight size={16} color="var(--text-muted)" />}
              <span style={{ flexShrink: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', fontFamily: 'var(--font-mono, monospace)' }}>
                {idx + 1}.
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-base)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {g.title}
              </span>
              <span style={{ flexShrink: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
                {lineCount(g.bodyRaw)}줄
              </span>
            </button>
            {isOpen && (
              <pre
                style={{
                  margin: 0,
                  padding: 'var(--space-4)',
                  paddingTop: 0,
                  fontSize: 'var(--fs-sm)',
                  fontFamily: 'inherit',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: 'var(--text-muted)',
                  borderTop: 'var(--hairline) solid var(--border-color)',
                }}
              >
                {g.bodyRaw}
              </pre>
            )}
          </li>
        )
      })}
    </ul>
  )
}
