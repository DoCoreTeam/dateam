'use client'

import { useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { fetcher } from '@/lib/swr-config'
import { Plus, X, Globe, Trash2, Save, ExternalLink, Sparkles, ChevronRight, Pencil } from 'lucide-react'
import { mutateGpu } from '@/lib/gpu/swr-keys'
import { countryFlag } from '@/lib/gpu/country-flag'

interface SupplierStats {
  id: string
  name: string
  location: string | null
  color: string
  contact: string | null
  country: string | null
  website: string | null
  description: string | null
  logo_url: string | null
  active_quotes: number
  lowest_count: number
  last_received: string | null
}

interface ContactRow {
  id: string; name: string; title: string | null; department: string | null
  email: string | null; phone: string | null; mobile: string | null; notes: string | null
}
interface SupplierDetail {
  supplier: {
    id: string; name: string; location: string | null; color: string; contact: string | null
    country: string | null; website: string | null; description: string | null; logo_url: string | null; account_id: string | null
  }
  contacts: ContactRow[]
  quotes: QuoteRow[]
  availability: Array<{ id: string; status: string; resp_qty: number | null; gpu_products: { model_name: string } | null }>
  stats: { total_quotes: number; confirmed_quotes: number; models: number }
}

interface QuoteRow {
  id: string; unit_price_usd: number; gpu_count: number; status: string
  term: string | null; term_months: number | null; min_qty: string | null; valid_until: string | null
  original_price: number | null; original_currency: string | null; original_unit: string | null
  gpu_products: { id: string; model_name: string; memory: string | null; tier: number } | null
}

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6', '#ec4899', '#14b8a6', '#f97316', '#84cc16']
const STATUS_LABEL: Record<string, { t: string; c: string }> = {
  confirmed: { t: '확정', c: 'var(--gpu-green)' },
  pending: { t: '대기', c: 'var(--gpu-amber)' },
  superseded: { t: '대체됨', c: 'var(--gpu-faint)' },
  rejected: { t: '반려', c: 'var(--gpu-faint)' },
  expired: { t: '만료', c: 'var(--gpu-red)' },
}
const fmtUSD = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// 공급사 로고 — logo_url 있으면 이미지, 실패/없음 시 글자 아바타로 폴백
function LogoAvatar({ name, color, logoUrl, size = 40 }: { name: string; color: string; logoUrl?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false)
  if (logoUrl && !failed) {
    return (
      <div className="gpu-sup-logo" style={{ background: '#fff', border: '1px solid var(--gpu-border)', padding: 4, width: size, height: size, overflow: 'hidden' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} alt={name} width={size - 8} height={size - 8} style={{ objectFit: 'contain', width: '100%', height: '100%' }} onError={() => setFailed(true)} />
      </div>
    )
  }
  return <div className="gpu-sup-logo" style={{ background: color, width: size, height: size }}>{name.charAt(0)}</div>
}

function Field({ label, value, onChange, textarea }: { label: string; value: string; onChange: (v: string) => void; textarea?: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--gpu-muted)' }}>{label}</span>
      {textarea ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2}
          style={{ fontSize: 12.5, padding: '6px 8px', borderRadius: 6, border: '1.5px solid var(--gpu-border)', resize: 'vertical' }} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)}
          style={{ height: 30, fontSize: 12.5, padding: '0 8px', borderRadius: 6, border: '1.5px solid var(--gpu-border)' }} />
      )}
    </label>
  )
}

interface Suggestion { gpu_count?: number; price_basis?: string; unit_price_usd?: number; per_gpu_usd?: number; reason?: string; confidence?: number }

function QuoteEditModal({ quote, onClose, onChanged }: { quote: QuoteRow; onClose: () => void; onChanged: () => void }) {
  const [f, setF] = useState({
    unit_price_usd: String(quote.unit_price_usd ?? ''),
    gpu_count: String(quote.gpu_count ?? 1),
    term: quote.term ?? '',
    min_qty: quote.min_qty ?? '',
    valid_until: quote.valid_until ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [memo, setMemo] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }))

  const save = async () => {
    setSaving(true); setErr(null)
    try {
      const res = await fetch(`/api/pricing/gpu/quotes/${quote.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_price_usd: Number(f.unit_price_usd), gpu_count: Number(f.gpu_count),
          term: f.term, min_qty: f.min_qty, valid_until: f.valid_until || null,
        }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? '저장 실패'); return }
      onChanged(); onClose()
    } finally { setSaving(false) }
  }

  const del = async () => {
    if (!confirm('이 견적을 삭제할까요?')) return
    setSaving(true); setErr(null)
    try {
      const res = await fetch(`/api/pricing/gpu/quotes/${quote.id}`, { method: 'DELETE' })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? '삭제 실패'); return }
      onChanged(); onClose()
    } finally { setSaving(false) }
  }

  const reanalyze = async () => {
    setAnalyzing(true); setErr(null); setSuggestion(null)
    try {
      const res = await fetch(`/api/pricing/gpu/quotes/${quote.id}/reanalyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memo }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(j.error ?? 'AI 재분석 실패'); return }
      setSuggestion(j.suggestion as Suggestion)
    } finally { setAnalyzing(false) }
  }

  const applySuggestion = () => {
    if (!suggestion) return
    setF((p) => ({
      ...p,
      unit_price_usd: suggestion.unit_price_usd != null ? String(suggestion.unit_price_usd) : p.unit_price_usd,
      gpu_count: suggestion.gpu_count != null ? String(suggestion.gpu_count) : p.gpu_count,
    }))
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(560px, 100%)', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--gpu-border)' }}>
          <strong style={{ fontSize: 15, flex: 1 }}>
            {quote.gpu_products?.model_name ?? '상품 미연결'} {quote.gpu_products?.memory ?? ''} 견적 수정
          </strong>
          <button onClick={onClose} className="gpu-btn" style={{ padding: 6 }}><X size={16} /></button>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* 편집 필드 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="단가 USD (구성 총액/hr)" value={f.unit_price_usd} onChange={(v) => set('unit_price_usd', v)} />
            <Field label="GPU 장수" value={f.gpu_count} onChange={(v) => set('gpu_count', v)} />
            <Field label="계약 기간" value={f.term} onChange={(v) => set('term', v)} />
            <Field label="최소 수량" value={f.min_qty} onChange={(v) => set('min_qty', v)} />
            <Field label="유효기한 (YYYY-MM-DD)" value={f.valid_until} onChange={(v) => set('valid_until', v)} />
          </div>

          {/* 이전 입력값(원본) — 그대로 보존 표시 */}
          <div style={{ padding: '10px 12px', borderRadius: 8, background: '#f9fafb', border: '1px solid #eef0f6' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gpu-muted)', marginBottom: 4 }}>이전 입력값 (원본 · 보존됨)</div>
            <div style={{ fontSize: 12, color: 'var(--gpu-ink-2)', fontFamily: 'monospace' }}>
              {quote.original_price != null ? `${quote.original_price} ${quote.original_currency ?? ''} ${quote.original_unit ?? ''}` : '원본 입력값 없음'}
            </div>
          </div>

          {/* AI 재분석 */}
          <div style={{ padding: '12px', borderRadius: 8, background: 'rgba(91,94,240,0.05)', border: '1px solid var(--gpu-accent, #5b5ef0)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Sparkles size={14} style={{ color: 'var(--gpu-accent)' }} />
              <strong style={{ fontSize: 12.5 }}>AI 재분석</strong>
              <span style={{ fontSize: 11, color: 'var(--gpu-muted)' }}>원본값 기준으로 장수·단가 재정규화 제안</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="추가 메모(선택): 예) 640GB는 8장 세트"
                style={{ flex: 1, height: 30, fontSize: 12, padding: '0 8px', borderRadius: 6, border: '1.5px solid var(--gpu-border)' }} />
              <button onClick={reanalyze} disabled={analyzing} className="gpu-btn gpu-btn-primary" style={{ gap: 5, whiteSpace: 'nowrap' }}>
                <Sparkles size={13} /> {analyzing ? '분석 중…' : '재분석'}
              </button>
            </div>
            {suggestion && (
              <div style={{ marginTop: 10, fontSize: 12.5 }}>
                <div style={{ display: 'flex', gap: 12, fontFamily: 'monospace', fontWeight: 700 }}>
                  <span>장수 {suggestion.gpu_count}</span>
                  <span>단가 ${suggestion.unit_price_usd}</span>
                  <span>1장당 ${suggestion.per_gpu_usd}</span>
                  <span style={{ color: 'var(--gpu-muted)', fontWeight: 400 }}>{suggestion.price_basis}</span>
                  {suggestion.confidence != null && <span style={{ marginLeft: 'auto', color: 'var(--gpu-accent)' }}>{suggestion.confidence}%</span>}
                </div>
                {suggestion.reason && <div style={{ marginTop: 4, color: 'var(--gpu-muted)' }}>{suggestion.reason}</div>}
                <button onClick={applySuggestion} className="gpu-btn" style={{ marginTop: 8, fontSize: 12, gap: 5 }}>
                  <ChevronRight size={13} /> 제안값 입력에 반영
                </button>
              </div>
            )}
          </div>

          {err && <div style={{ fontSize: 12, color: 'var(--gpu-red)' }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={saving} className="gpu-btn gpu-btn-primary" style={{ gap: 5 }}><Save size={14} /> {saving ? '저장 중…' : '저장'}</button>
            <button onClick={del} disabled={saving} className="gpu-btn" style={{ marginLeft: 'auto', color: 'var(--gpu-red)', gap: 5 }}><Trash2 size={14} /> 삭제</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SupplierDetailModal({ id, onClose, onChanged, onGoToPriceTable }: { id: string; onClose: () => void; onChanged: () => void; onGoToPriceTable?: (modelName: string, productId: string) => void }) {
  const { data, mutate } = useSWR<SupplierDetail>(`/api/pricing/gpu/suppliers/${id}`, fetcher)
  const [form, setForm] = useState<Record<string, string> | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [editQuote, setEditQuote] = useState<QuoteRow | null>(null)
  const [editing, setEditing] = useState(false)              // 조회-우선: 기본 조회, 수정 클릭 시 편집
  const [newContact, setNewContact] = useState({ name: '', title: '', email: '', phone: '' })
  const [contactSaving, setContactSaving] = useState(false)

  const s = data?.supplier
  const f = form ?? (s ? { name: s.name, country: s.country ?? '', website: s.website ?? '', contact: s.contact ?? '', location: s.location ?? '', description: s.description ?? '', color: s.color ?? COLORS[0] } : null)
  const set = (k: string, v: string) => setForm({ ...(f as Record<string, string>), [k]: v })

  const save = async () => {
    if (!f) return
    setSaving(true); setErr(null)
    try {
      const res = await fetch(`/api/pricing/gpu/suppliers/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? '저장 실패'); return }
      await mutate(); onChanged()
    } finally { setSaving(false) }
  }

  const del = async () => {
    if (!confirm(`'${s?.name}' 공급사를 삭제할까요?`)) return
    setSaving(true); setErr(null)
    try {
      const res = await fetch(`/api/pricing/gpu/suppliers/${id}`, { method: 'DELETE' })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? '삭제 실패'); return }
      onChanged(); onClose()
    } finally { setSaving(false) }
  }

  // 담당자(contacts) — 회사=accounts 통합. 공급사 account에 담당자 추가/삭제.
  const addContact = async () => {
    if (!data?.supplier.account_id || !newContact.name.trim()) return
    setContactSaving(true)
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: data.supplier.account_id, name: newContact.name.trim(), title: newContact.title || null, email: newContact.email || null, phone: newContact.phone || null }),
      })
      if (res.ok) { setNewContact({ name: '', title: '', email: '', phone: '' }); await mutate() }
    } finally { setContactSaving(false) }
  }
  const delContact = async (cid: string) => {
    if (!confirm('담당자를 삭제할까요?')) return
    const res = await fetch(`/api/contacts/${cid}`, { method: 'DELETE' })
    if (res.ok) await mutate()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(720px, 100%)', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--gpu-border)', position: 'sticky', top: 0, background: '#fff' }}>
          <LogoAvatar name={s?.name ?? '?'} color={f?.color || s?.color || COLORS[0]} logoUrl={s?.logo_url} />

          <strong style={{ fontSize: 16, flex: 1 }}>
            {s?.name ?? '로딩…'}
            {s?.country && <span style={{ marginLeft: 8, fontSize: 15, fontWeight: 400 }}>{countryFlag(s.country)} {s.country}</span>}
          </strong>
          {data && (
            <span style={{ fontSize: 11.5, color: 'var(--gpu-muted)' }}>
              확정 {data.stats.confirmed_quotes}건 · {data.stats.models}개 모델
            </span>
          )}
          <button onClick={onClose} className="gpu-btn" style={{ padding: 6 }}><X size={16} /></button>
        </div>

        {!data ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--gpu-muted)' }}>로딩 중…</div>
        ) : (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 회사 정보 — 조회 우선, 수정 클릭 시 편집 (거래처/딜과 동일 UX) */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>회사 정보</div>
                {!editing && (
                  <button onClick={() => { setForm(null); setEditing(true) }} className="gpu-btn" style={{ marginLeft: 'auto', gap: 4, fontSize: 12 }}>
                    <Pencil size={13} /> 수정
                  </button>
                )}
              </div>

              {!editing ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 18px' }}>
                  {[['국가', s?.country], ['웹사이트', s?.website], ['연락처(레거시)', s?.contact], ['소개', s?.description]].map(([label, val]) => (
                    <div key={label as string} style={{ fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 11, color: 'var(--gpu-muted)', fontWeight: 600 }}>{label}</span>
                      <span style={{ fontWeight: 600 }}>{(val as string) || '—'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Field label="공급사명" value={f?.name ?? ''} onChange={(v) => set('name', v)} />
                    <Field label="국가" value={f?.country ?? ''} onChange={(v) => set('country', v)} />
                    <Field label="웹사이트" value={f?.website ?? ''} onChange={(v) => set('website', v)} />
                    <Field label="연락처(레거시)" value={f?.contact ?? ''} onChange={(v) => set('contact', v)} />
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <Field label="회사 소개" value={f?.description ?? ''} onChange={(v) => set('description', v)} textarea />
                  </div>
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--gpu-muted)' }}>색상</span>
                    {COLORS.map((c) => (
                      <button key={c} onClick={() => set('color', c)} aria-label={`색상 ${c}`}
                        style={{ width: 20, height: 20, borderRadius: '50%', background: c, border: (f?.color === c) ? '2px solid #0f172a' : '2px solid transparent', cursor: 'pointer' }} />
                    ))}
                  </div>
                  {err && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--gpu-red)' }}>{err}</div>}
                  <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                    <button onClick={async () => { await save(); setEditing(false) }} disabled={saving} className="gpu-btn gpu-btn-primary" style={{ gap: 5 }}>
                      <Save size={14} /> {saving ? '저장 중…' : '저장'}
                    </button>
                    <button onClick={() => { setForm(null); setEditing(false) }} className="gpu-btn">취소</button>
                    {f?.website && (
                      <a href={f.website} target="_blank" rel="noreferrer" className="gpu-btn" style={{ gap: 5, textDecoration: 'none' }}>
                        <ExternalLink size={14} /> 사이트
                      </a>
                    )}
                    <button onClick={del} disabled={saving} className="gpu-btn" style={{ marginLeft: 'auto', color: 'var(--gpu-red)', gap: 5 }}>
                      <Trash2 size={14} /> 삭제
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* 담당자 (contacts — 딜 담당자와 동일 모델) */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>담당자 ({data.contacts?.length ?? 0})</div>
              {(data.contacts?.length ?? 0) === 0 && !editing && (
                <div style={{ fontSize: 12, color: 'var(--gpu-faint)', padding: '4px 0' }}>등록된 담당자가 없습니다 {data.supplier.account_id ? '— 수정에서 추가' : ''}</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(data.contacts ?? []).map((c) => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 7, background: '#f9fafb', border: '1px solid #eef0f6', fontSize: 12.5 }}>
                    <span style={{ fontWeight: 700, minWidth: 90 }}>{c.name}</span>
                    {c.title && <span style={{ color: 'var(--gpu-muted)' }}>{c.title}</span>}
                    <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 12, color: 'var(--gpu-ink-2)' }}>{c.email ?? ''} {c.phone ?? ''}</span>
                    {editing && <button onClick={() => delContact(c.id)} className="gpu-btn" style={{ padding: 4, color: 'var(--gpu-red)' }}><Trash2 size={13} /></button>}
                  </div>
                ))}
              </div>
              {editing && data.supplier.account_id && (
                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.4fr 1fr auto', gap: 6, alignItems: 'end' }}>
                  <Field label="이름*" value={newContact.name} onChange={(v) => setNewContact((p) => ({ ...p, name: v }))} />
                  <Field label="직책" value={newContact.title} onChange={(v) => setNewContact((p) => ({ ...p, title: v }))} />
                  <Field label="이메일" value={newContact.email} onChange={(v) => setNewContact((p) => ({ ...p, email: v }))} />
                  <Field label="전화" value={newContact.phone} onChange={(v) => setNewContact((p) => ({ ...p, phone: v }))} />
                  <button onClick={addContact} disabled={contactSaving || !newContact.name.trim()} className="gpu-btn gpu-btn-primary" style={{ height: 30, gap: 4 }}>
                    <Plus size={13} /> 추가
                  </button>
                </div>
              )}
            </div>

            {/* 이 공급사의 모든 견적 */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>공급 견적 ({data.quotes.length})</div>
              {data.quotes.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--gpu-faint)', padding: '12px 0' }}>등록된 견적이 없습니다</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {data.quotes.map((q) => {
                    const st = STATUS_LABEL[q.status] ?? { t: q.status, c: 'var(--gpu-faint)' }
                    const prod = q.gpu_products
                    const canLocate = !!(prod && onGoToPriceTable)
                    return (
                      <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 7, background: '#f9fafb', border: '1px solid #eef0f6', fontSize: 12.5 }}>
                        <button onClick={() => setEditQuote(q)} title="클릭하면 견적 수정·삭제·AI 재분석"
                          style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, padding: 0, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>
                          <span style={{ fontWeight: 600, minWidth: 110 }}>
                            {prod?.model_name ?? '상품 미연결'}
                            {prod?.memory && <span style={{ color: 'var(--gpu-muted)', fontWeight: 400 }}> {prod.memory}</span>}
                          </span>
                          <span style={{ color: 'var(--gpu-muted)' }}>×{q.gpu_count}GPU</span>
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, marginLeft: 'auto' }}>{fmtUSD(q.unit_price_usd)}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: st.c, minWidth: 36, textAlign: 'right' }}>{st.t}</span>
                        </button>
                        <button
                          onClick={() => { if (canLocate && prod) { onClose(); onGoToPriceTable!(prod.model_name, prod.id) } }}
                          disabled={!canLocate}
                          title={canLocate ? '가격표에서 이 가격 위치 보기' : '상품 미연결 — 가격표 탐색 불가'}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--gpu-border)', background: '#fff', color: canLocate ? 'var(--gpu-accent)' : 'var(--gpu-faint)', fontSize: 11, fontWeight: 600, cursor: canLocate ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          가격표 <ChevronRight size={13} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 가용량(재고) */}
            {data.availability.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>가용 재고</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {data.availability.map((a) => (
                    <div key={a.id} style={{ display: 'flex', gap: 10, padding: '6px 10px', borderRadius: 6, background: '#f0fdf4', fontSize: 12.5 }}>
                      <span style={{ fontWeight: 600 }}>{a.gpu_products?.model_name ?? '—'}</span>
                      <span style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--gpu-green)' }}>{a.resp_qty ?? 0} GPU</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {editQuote && (
        <QuoteEditModal
          quote={editQuote}
          onClose={() => setEditQuote(null)}
          onChanged={() => { mutate(); onChanged() }}
        />
      )}
    </div>
  )
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({ name: '', country: '', website: '', contact: '', description: '', color: COLORS[0] })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: string, v: string) => setF({ ...f, [k]: v })

  const create = async () => {
    if (!f.name.trim()) { setErr('공급사명을 입력하세요'); return }
    setSaving(true); setErr(null)
    try {
      const res = await fetch('/api/pricing/gpu/suppliers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? '생성 실패'); return }
      onCreated(); onClose()
    } finally { setSaving(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(520px, 100%)', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--gpu-border)' }}>
          <strong style={{ fontSize: 15, flex: 1 }}>공급사 추가</strong>
          <button onClick={onClose} className="gpu-btn" style={{ padding: 6 }}><X size={16} /></button>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="공급사명 *" value={f.name} onChange={(v) => set('name', v)} />
            <Field label="국가" value={f.country} onChange={(v) => set('country', v)} />
            <Field label="웹사이트" value={f.website} onChange={(v) => set('website', v)} />
            <Field label="연락처" value={f.contact} onChange={(v) => set('contact', v)} />
          </div>
          <Field label="회사 소개" value={f.description} onChange={(v) => set('description', v)} textarea />
          {err && <div style={{ fontSize: 12, color: 'var(--gpu-red)' }}>{err}</div>}
          <button onClick={create} disabled={saving} className="gpu-btn gpu-btn-primary">{saving ? '생성 중…' : '추가'}</button>
        </div>
      </div>
    </div>
  )
}

export default function SuppliersTab({ onGoToPriceTable }: { onGoToPriceTable?: (modelName: string, productId: string) => void }) {
  const { data } = useSWR<{ suppliers: SupplierStats[] }>('/api/pricing/gpu/suppliers', fetcher)
  const { mutate } = useSWRConfig()
  const suppliers = data?.suppliers ?? []
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const refresh = () => { mutate('/api/pricing/gpu/suppliers'); mutateGpu(mutate) }

  const filtered = search.trim()
    ? suppliers.filter((s) =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.country ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (s.location ?? '').toLowerCase().includes(search.toLowerCase()))
    : suppliers

  return (
    <div>
      <div className="gpu-toolbar">
        <div className="gpu-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>
          <input placeholder="공급사·국가 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="gpu-btn gpu-btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={15} /> 공급사 추가
        </button>
      </div>

      <div className="gpu-sup-grid">
        {filtered.map((s) => (
          <div key={s.id} className="gpu-sup-card" onClick={() => setOpenId(s.id)} style={{ cursor: 'pointer' }}>
            <div className="gpu-sup-head">
              <LogoAvatar name={s.name} color={s.color} logoUrl={s.logo_url} />
              <div style={{ flex: 1 }}>
                <div className="gpu-sup-nm">{s.name}</div>
                <div className="gpu-sup-loc" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {s.country && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><span style={{ fontSize: 14 }}>{countryFlag(s.country)}</span>{s.country}</span>}
                  {s.website && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--gpu-accent)' }}><Globe size={11} />사이트</span>}
                </div>
              </div>
            </div>

            {s.description && (
              <div style={{ fontSize: 11.5, color: 'var(--gpu-muted)', margin: '2px 0 8px', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {s.description}
              </div>
            )}

            <div className="gpu-sup-stats">
              <div className="gpu-sup-s"><div className="gpu-sup-s-n gpu-mono">{s.active_quotes}</div><div className="gpu-sup-s-l">활성 견적</div></div>
              <div className="gpu-sup-s"><div className="gpu-sup-s-n gpu-mono">{s.lowest_count}</div><div className="gpu-sup-s-l">최저가 보유</div></div>
              <div className="gpu-sup-s">
                <div className="gpu-sup-s-n gpu-mono" style={{ fontSize: 13 }}>
                  {s.last_received ? new Date(s.last_received).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : '—'}
                </div>
                <div className="gpu-sup-s-l">최근 수신</div>
              </div>
            </div>

            <div className="gpu-sup-foot">
              <span style={{ fontSize: 11.5, color: 'var(--gpu-accent)', fontWeight: 600 }}>클릭하면 상세 · 수정</span>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '60px 24px', color: 'var(--gpu-faint)', fontSize: '13px' }}>
            {suppliers.length === 0 ? '등록된 공급사가 없습니다' : '검색 결과가 없습니다'}
          </div>
        )}
      </div>

      {openId && <SupplierDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={refresh} onGoToPriceTable={onGoToPriceTable} />}
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreated={refresh} />}
    </div>
  )
}
