'use client'

import { useState } from 'react'
import { Sparkles, AlertTriangle, Check } from 'lucide-react'

// AI 예상 프로젝트 제안 (§5-3 추출형) — 후보를 "제목+근거+업무수+체크박스" 리스트로 제시.
// 사용자가 선택 → 확정(confirm)으로만 생성(자동 생성 금지). 날짜·예산은 생성 후 수정으로 채운다.
interface Suggestion {
  suggestedName: string
  reason: string
  taskCount: number
  sampleLogIds: string[]
}

interface Props {
  onConfirmed: () => void
}

export default function ProjectAiSuggest({ onConfirmed }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [confirming, setConfirming] = useState(false)

  async function load() {
    setOpen(true); setLoading(true); setError(null); setPicked(new Set())
    try {
      const res = await fetch('/api/work/projects/suggest')
      if (!res.ok) { setError('제안을 불러오지 못했습니다'); setLoading(false); return }
      const data = await res.json()
      setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : [])
    } catch {
      setError('서버 연결에 실패했습니다')
    }
    setLoading(false)
  }

  function toggle(i: number) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })
  }

  async function confirm() {
    if (!suggestions || picked.size === 0 || confirming) return
    setConfirming(true); setError(null)
    try {
      const targets = Array.from(picked).map((i) => suggestions[i])
      const results = await Promise.all(targets.map((s) =>
        fetch('/api/work/projects/confirm', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: s.suggestedName, logIds: s.sampleLogIds }),
        })))
      if (results.some((r) => !r.ok)) { setError('일부 항목 생성에 실패했습니다'); setConfirming(false); return }
      setOpen(false); setSuggestions(null); setPicked(new Set())
      onConfirmed()
    } catch {
      setError('서버 연결에 실패했습니다')
    }
    setConfirming(false)
  }

  return (
    <section aria-labelledby="ai-suggest-heading"
      style={{ marginBottom: 'var(--space-4)', borderRadius: 'var(--radius-lg)', border: 'var(--hairline) solid var(--border-light)', background: 'var(--surface-bg)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)' }}>
        <Sparkles size={16} style={{ color: 'var(--brand)', flexShrink: 0 }} aria-hidden />
        <h2 id="ai-suggest-heading" style={{ margin: 0, fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text)' }}>AI 예상 프로젝트</h2>
        <button onClick={open ? () => setOpen(false) : load} data-testid="ai-suggest-toggle"
          style={{ marginLeft: 'auto', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--brand)', background: 'none', border: 'var(--border-w-2) solid var(--brand)', borderRadius: 'var(--radius)', padding: 'var(--space-1) var(--space-4)', minHeight: 36, cursor: 'pointer' }}>
          {open ? '닫기' : '제안 받기'}
        </button>
      </div>

      {open && (
        <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
          {error && (
            <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', background: 'var(--danger-bg)', border: 'var(--hairline) solid var(--danger-border)', borderRadius: 'var(--radius)', marginBottom: 'var(--space-2)', fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>
              <AlertTriangle size={15} /> {error}
            </div>
          )}

          {loading ? (
            <p style={{ margin: 0, padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>분석하는 중…</p>
          ) : suggestions && suggestions.length === 0 ? (
            <p style={{ margin: 0, padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>
              아직 묶을 만한 업무 흐름이 없습니다. 업무가 쌓이면 다시 제안해 드릴게요.
            </p>
          ) : suggestions && suggestions.length > 0 ? (
            <>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {suggestions.map((s, i) => {
                  const on = picked.has(i)
                  return (
                    <li key={`${s.suggestedName}-${i}`}>
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', padding: 'var(--space-3)', borderRadius: 'var(--radius)', border: `var(--border-w-2) solid ${on ? 'var(--brand)' : 'var(--border-color)'}`, background: 'var(--color-bg)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={on} onChange={() => toggle(i)} aria-label={`${s.suggestedName} 선택`} style={{ marginTop: 2, flexShrink: 0, width: 18, height: 18, cursor: 'pointer' }} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)', wordBreak: 'break-word' }}>{s.suggestedName}</span>
                          <span style={{ display: 'block', marginTop: 2, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.45 }}>{s.reason}</span>
                        </span>
                        <span style={{ flexShrink: 0, fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--brand)', background: 'var(--surface-bg)', borderRadius: '9999px', padding: '2px 8px' }}>업무 {s.taskCount}건</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-3)', justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginRight: 'auto' }}>선택한 후보만 프로젝트로 생성됩니다. 기간·예산은 생성 후 수정에서 채울 수 있어요.</span>
                <button onClick={confirm} disabled={picked.size === 0 || confirming} data-testid="ai-confirm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--brand-fg)', background: picked.size === 0 ? 'var(--text-faint)' : 'var(--brand)', border: 'none', borderRadius: 'var(--radius)', padding: 'var(--space-2) var(--space-4)', minHeight: 36, cursor: picked.size === 0 || confirming ? 'not-allowed' : 'pointer' }}>
                  <Check size={15} /> {confirming ? '생성중…' : `선택 ${picked.size}건 생성`}
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </section>
  )
}
