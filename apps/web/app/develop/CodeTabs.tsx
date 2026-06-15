'use client'

import { useState } from 'react'
import { LANGUAGES, type RequestSpec } from '@/lib/api-docs/snippets'

interface CodeTabsProps {
  spec: RequestSpec
  baseUrl: string
  id: string
  onCopy: (text: string, id: string) => void
  copiedId: string | null
}

// 엔드포인트 요청 1개(RequestSpec)를 7개 언어 탭으로 렌더.
// 스니펫은 lib/api-docs/snippets(SSOT)에서 생성 — 화면에서 손코딩하지 않는다.
export default function CodeTabs({ spec, baseUrl, id, onCopy, copiedId }: CodeTabsProps) {
  const [activeLang, setActiveLang] = useState(LANGUAGES[0].id)
  const lang = LANGUAGES.find(l => l.id === activeLang) ?? LANGUAGES[0]
  const code = lang.generate(spec, baseUrl)
  const copyId = `${id}-${lang.id}`

  // 좌우 화살표로 탭 이동 (WAI-ARIA tabs 키보드 패턴)
  function onTabKey(e: React.KeyboardEvent, idx: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = e.key === 'ArrowRight' ? (idx + 1) % LANGUAGES.length : (idx - 1 + LANGUAGES.length) % LANGUAGES.length
    setActiveLang(LANGUAGES[next].id)
  }

  return (
    <div style={{ background: 'var(--text)', border: 'var(--hairline) solid var(--text)', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 10px 6px 6px', background: 'var(--text)', borderBottom: 'var(--hairline) solid var(--text)', flexWrap: 'wrap' }}>
        <div role="tablist" aria-label="언어 선택" style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {LANGUAGES.map((l, idx) => {
            const active = l.id === activeLang
            return (
              <button
                key={l.id}
                role="tab"
                id={`${id}-tab-${l.id}`}
                aria-selected={active}
                aria-controls={`${id}-panel`}
                tabIndex={active ? 0 : -1}
                onKeyDown={e => onTabKey(e, idx)}
                onClick={() => setActiveLang(l.id)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 6,
                  border: 'none',
                  background: active ? 'var(--brand)' : 'transparent',
                  color: active ? '#fff' : 'var(--text-faint)',
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  transition: 'all 0.12s',
                }}
              >
                {l.label}
              </button>
            )
          })}
        </div>
        <button onClick={() => onCopy(code, copyId)} style={{ flexShrink: 0, padding: '3px 10px', borderRadius: 6, border: 'var(--hairline) solid var(--text)', background: 'var(--text)', color: copiedId === copyId ? 'var(--success)' : 'var(--text-faint)', fontSize: 12, cursor: 'pointer' }}>
          {copiedId === copyId ? '✓ 복사됨' : '복사'}
        </button>
      </div>
      <pre id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${lang.id}`} style={{ margin: 0, padding: 'var(--space-5) var(--space-6)', fontSize: 13, lineHeight: 1.7, color: 'var(--color-border)', overflowX: 'auto', whiteSpace: 'pre' }}>{code}</pre>
    </div>
  )
}
