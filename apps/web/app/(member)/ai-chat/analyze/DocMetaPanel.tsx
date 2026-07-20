'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, FileText } from 'lucide-react'
import type { DocMetaEntry } from '@/lib/ai-chat/grouping/types'

interface Props {
  meta: DocMetaEntry[]
}

/** 문서 메타 패널 — "제외"가 아니라 "분리 보관"임을 명시(§B, 유실 0 신뢰 장치의 일부). 비어 있으면 숨김. */
export default function DocMetaPanel({ meta }: Props) {
  const [open, setOpen] = useState(false)
  if (meta.length === 0) return null

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
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
          color: 'var(--text)',
        }}
      >
        {open ? <ChevronDown size={16} color="var(--text-muted)" /> : <ChevronRight size={16} color="var(--text-muted)" />}
        <FileText size={14} color="var(--text-muted)" />
        <span style={{ flex: 1, fontSize: 'var(--fs-sm)', fontWeight: 600 }}>
          문서 메타 {meta.length}건
        </span>
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>삭제 아님 — 분리 보관됨</span>
      </button>
      {open && (
        <dl
          style={{
            margin: 0,
            padding: 'var(--space-4)',
            paddingTop: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
            borderTop: 'var(--hairline) solid var(--border-color)',
            fontSize: 'var(--fs-sm)',
          }}
        >
          {meta.map((m, i) => (
            <div key={`${m.key}-${i}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              <dt style={{ minWidth: '5rem', color: 'var(--text-muted)', fontWeight: 600 }}>{m.key}</dt>
              <dd style={{ margin: 0, flex: 1, minWidth: 0, color: 'var(--text)' }}>{m.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
