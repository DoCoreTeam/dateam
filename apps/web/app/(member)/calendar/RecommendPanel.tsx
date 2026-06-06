'use client'

import { useState } from 'react'
import { mutate as globalMutate } from 'swr'
import { Sparkles, Plus, X } from 'lucide-react'
import { getCalendarRecommendations, createCalendarEvent, type Recommendation } from './actions'

export default function RecommendPanel() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [items, setItems] = useState<Recommendation[] | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function load() {
    setOpen(true); setBusy(true); setMsg(null); setItems(null)
    const r = await getCalendarRecommendations()
    setBusy(false)
    if (!r.ok) { setMsg(r.error ?? '추천 실패'); return }
    setItems(r.items ?? [])
    if ((r.items ?? []).length === 0) setMsg('추천할 만한 후보가 없습니다 (미완료 업무·주간계획·메모 부족)')
  }

  async function register(rec: Recommendation, idx: number) {
    const res = await createCalendarEvent({
      title: rec.title, start_at: rec.start_at, source: 'ai',
      link_kind: rec.link_kind ?? null, link_id: rec.link_id ?? null,
    })
    if (res.ok) {
      globalMutate((key) => typeof key === 'string' && key.startsWith('/api/calendar/events'))
      setItems((prev) => (prev ? prev.filter((_, i) => i !== idx) : prev))
    }
  }

  return (
    <div style={{ marginBottom: '1rem' }}>
      {!open ? (
        <button onClick={load} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', fontWeight: 600, color: '#7c3aed', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 'var(--radius)', padding: '0.45rem 0.875rem', cursor: 'pointer' }}>
          <Sparkles size={15} /> AI 일정 추천 받기
        </button>
      ) : (
        <div className="card" style={{ padding: '1rem 1.25rem', border: '1px solid #ddd6fe', background: 'linear-gradient(to right,#faf5ff,#fdf4ff)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.875rem', fontWeight: 700, color: '#6d28d9' }}>
              <Sparkles size={15} /> AI 추천 일정 {busy && '(분석 중…)'}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={load} disabled={busy} style={{ fontSize: '0.75rem', color: '#7c3aed', background: 'none', border: 'none', cursor: 'pointer' }}>다시</button>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={16} /></button>
            </div>
          </div>
          {msg && <p style={{ fontSize: '0.8rem', color: '#7c3aed', margin: '0 0 0.5rem' }}>{msg}</p>}
          {busy && <p style={{ fontSize: '0.8rem', color: '#a78bfa', margin: 0 }}>일일업무·주간계획·메모를 종합하는 중…</p>}
          {items && items.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {items.map((rec, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.625rem 0.75rem', background: '#fff', border: '1px solid #e9d5ff', borderRadius: 'var(--radius)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1e293b' }}>
                      <span style={{ color: '#7c3aed', fontWeight: 700, marginRight: '0.4rem' }}>{rec.start_at.slice(5, 16).replace('T', ' ')}</span>
                      {rec.title}
                    </div>
                    {rec.reason && <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.15rem' }}>근거: {rec.reason}</div>}
                  </div>
                  <button onClick={() => register(rec, i)} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.75rem', fontWeight: 600, color: '#fff', background: '#7c3aed', border: 'none', borderRadius: '0.375rem', padding: '0.35rem 0.625rem', cursor: 'pointer', flexShrink: 0 }}>
                    <Plus size={13} /> 등록
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
