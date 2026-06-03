'use client'

import { useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { fetcher } from '@/lib/swr-config'
import { Plus, X, Globe, MapPin, Trash2, Save, ExternalLink } from 'lucide-react'
import { mutateGpu } from '@/lib/gpu/swr-keys'

interface SupplierStats {
  id: string
  name: string
  location: string | null
  color: string
  contact: string | null
  country: string | null
  website: string | null
  description: string | null
  active_quotes: number
  lowest_count: number
  last_received: string | null
}

interface SupplierDetail {
  supplier: {
    id: string; name: string; location: string | null; color: string; contact: string | null
    country: string | null; website: string | null; description: string | null
  }
  quotes: Array<{
    id: string; unit_price_usd: number; gpu_count: number; status: string
    term: string | null; valid_until: string | null
    gpu_products: { model_name: string; memory: string | null; tier: number } | null
  }>
  availability: Array<{ id: string; status: string; resp_qty: number | null; gpu_products: { model_name: string } | null }>
  stats: { total_quotes: number; confirmed_quotes: number; models: number }
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

function SupplierDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, mutate } = useSWR<SupplierDetail>(`/api/pricing/gpu/suppliers/${id}`, fetcher)
  const [form, setForm] = useState<Record<string, string> | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

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

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(720px, 100%)', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--gpu-border)', position: 'sticky', top: 0, background: '#fff' }}>
          <div className="gpu-sup-logo" style={{ background: f?.color || s?.color }}>{(s?.name ?? '?').charAt(0)}</div>
          <strong style={{ fontSize: 16, flex: 1 }}>{s?.name ?? '로딩…'}</strong>
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
            {/* 회사정보 편집 */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>회사 정보</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="공급사명" value={f?.name ?? ''} onChange={(v) => set('name', v)} />
                <Field label="국가" value={f?.country ?? ''} onChange={(v) => set('country', v)} />
                <Field label="웹사이트" value={f?.website ?? ''} onChange={(v) => set('website', v)} />
                <Field label="연락처" value={f?.contact ?? ''} onChange={(v) => set('contact', v)} />
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
                <button onClick={save} disabled={saving} className="gpu-btn gpu-btn-primary" style={{ gap: 5 }}>
                  <Save size={14} /> {saving ? '저장 중…' : '저장'}
                </button>
                {f?.website && (
                  <a href={f.website} target="_blank" rel="noreferrer" className="gpu-btn" style={{ gap: 5, textDecoration: 'none' }}>
                    <ExternalLink size={14} /> 사이트
                  </a>
                )}
                <button onClick={del} disabled={saving} className="gpu-btn" style={{ marginLeft: 'auto', color: 'var(--gpu-red)', gap: 5 }}>
                  <Trash2 size={14} /> 삭제
                </button>
              </div>
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
                    return (
                      <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 7, background: '#f9fafb', border: '1px solid #eef0f6', fontSize: 12.5 }}>
                        <span style={{ fontWeight: 600, minWidth: 110 }}>
                          {q.gpu_products?.model_name ?? '상품 미연결'}
                          {q.gpu_products?.memory && <span style={{ color: 'var(--gpu-muted)', fontWeight: 400 }}> {q.gpu_products.memory}</span>}
                        </span>
                        <span style={{ color: 'var(--gpu-muted)' }}>×{q.gpu_count}GPU</span>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, marginLeft: 'auto' }}>{fmtUSD(q.unit_price_usd)}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: st.c, minWidth: 36, textAlign: 'right' }}>{st.t}</span>
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

export default function SuppliersTab() {
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
              <div className="gpu-sup-logo" style={{ background: s.color }}>{s.name.charAt(0)}</div>
              <div style={{ flex: 1 }}>
                <div className="gpu-sup-nm">{s.name}</div>
                <div className="gpu-sup-loc" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {s.country && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><MapPin size={11} />{s.country}</span>}
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

      {openId && <SupplierDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={refresh} />}
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreated={refresh} />}
    </div>
  )
}
