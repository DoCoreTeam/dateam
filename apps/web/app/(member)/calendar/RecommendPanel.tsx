'use client'

import { useState } from 'react'
import { useSWRConfig } from 'swr'
import { Sparkles, Plus, X } from 'lucide-react'
import { getCalendarRecommendations, createCalendarEvent, type Recommendation } from './actions'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'

export default function RecommendPanel() {
  // Context-aware mutate — 전역 mutate는 SWRProvider 영속캐시를 못 건드림(저장 후 미반영 회귀 방지)
  const { mutate } = useSWRConfig()
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
      mutate((key) => typeof key === 'string' && key.startsWith('/api/calendar/events'))
      setItems((prev) => (prev ? prev.filter((_, i) => i !== idx) : prev))
    }
  }

  return (
    <div style={{ marginBottom: '1rem' }}>
      {!open ? (
        <button type="button" onClick={load} className="btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
          <Sparkles size={15} /> AI 일정 추천 받기
        </button>
      ) : (
        <div className="card" style={{ padding: 'var(--space-4) var(--space-5)', border: 'var(--hairline) solid var(--brand-soft-2)', background: 'linear-gradient(to right,var(--brand-soft),var(--brand-soft))' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--brand)' }}>
              <Sparkles size={15} /> AI 추천 일정 {busy && '(분석 중…)'}
            </span>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button type="button" onClick={load} disabled={busy} className="btn-ghost">다시</button>
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost" aria-label="닫기"><X size={16} /></button>
            </div>
          </div>
          {msg && <p style={{ fontSize: '0.8rem', color: 'var(--brand)', margin: '0 0 0.5rem' }}>{msg}</p>}
          {busy && <p style={{ fontSize: '0.8rem', color: 'var(--brand-soft-2)', margin: 0 }}>일일업무·주간계획·메모를 종합하는 중…</p>}
          {items && items.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {items.map((rec, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.625rem 0.75rem', background: 'var(--color-surface)', border: 'var(--hairline) solid var(--brand-soft-2)', borderRadius: 'var(--radius)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>
                      <span style={{ color: 'var(--brand)', fontWeight: 700, marginRight: '0.4rem' }}>{formatKstDateTimeShort(rec.start_at)}</span>
                      {rec.title}
                    </div>
                    {rec.reason && <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: '0.15rem' }}>근거: {rec.reason}</div>}
                  </div>
                  <button type="button" onClick={() => register(rec, i)} className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', flexShrink: 0 }}>
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
