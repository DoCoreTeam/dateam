'use client'

import { useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { fetcher } from '@/lib/swr-config'
import { Sparkles, X, Save, Pencil } from 'lucide-react'

interface Spec {
  model_name: string
  architecture: string | null
  vram_gb: number | null
  vram_type: string | null
  cuda_cores: number | null
  tensor_cores: number | null
  fp16_tflops: number | null
  bf16_tflops: number | null
  fp8_tflops: number | null
  nvlink: boolean | null
  nvlink_bandwidth: string | null
  tdp_w: number | null
  interface: string | null
  mig_support: boolean | null
  release_year: number | null
  datasheet_url: string | null
  notes: string | null
  ai_generated: boolean
  ai_confidence: number | null
}
interface ModelRow { model_name: string; tier: number; memory: string | null; spec: Spec | null; has_spec: boolean }

const FIELDS: { key: keyof Spec; label: string; type?: 'number' | 'bool' }[] = [
  { key: 'architecture', label: '아키텍처' },
  { key: 'vram_gb', label: 'VRAM(GB)', type: 'number' },
  { key: 'vram_type', label: 'VRAM 종류' },
  { key: 'cuda_cores', label: 'CUDA 코어', type: 'number' },
  { key: 'tensor_cores', label: '텐서 코어', type: 'number' },
  { key: 'fp16_tflops', label: 'FP16 TFLOPS', type: 'number' },
  { key: 'bf16_tflops', label: 'BF16 TFLOPS', type: 'number' },
  { key: 'fp8_tflops', label: 'FP8 TFLOPS', type: 'number' },
  { key: 'nvlink', label: 'NVLink', type: 'bool' },
  { key: 'nvlink_bandwidth', label: 'NVLink 대역폭' },
  { key: 'tdp_w', label: 'TDP(W)', type: 'number' },
  { key: 'interface', label: '인터페이스' },
  { key: 'mig_support', label: 'MIG 지원', type: 'bool' },
  { key: 'release_year', label: '출시년', type: 'number' },
  { key: 'datasheet_url', label: '데이터시트 URL' },
  { key: 'notes', label: '메모' },
]

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? '지원' : '미지원'
  return String(v)
}

function SpecModal({ row, onClose, onSaved }: { row: ModelRow; onClose: () => void; onSaved: () => void }) {
  const [editing, setEditing] = useState(!row.has_spec)
  const [form, setForm] = useState<Record<string, string>>(() => {
    const f: Record<string, string> = {}
    for (const { key } of FIELDS) { const v = row.spec?.[key]; f[key] = v === null || v === undefined ? '' : String(v) }
    return f
  })
  const [saving, setSaving] = useState(false)
  const [gen, setGen] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }))

  const save = async () => {
    setSaving(true); setErr(null)
    try {
      const payload: Record<string, unknown> = { model_name: row.model_name }
      for (const { key, type } of FIELDS) {
        const raw = form[key as string]
        if (type === 'number') payload[key] = raw === '' ? null : Number(raw)
        else if (type === 'bool') payload[key] = raw === '' ? null : raw === 'true'
        else payload[key] = raw
      }
      const res = await fetch('/api/pricing/gpu/specs', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? '저장 실패'); return }
      onSaved(); onClose()
    } finally { setSaving(false) }
  }

  const regenerate = async () => {
    setGen(true); setErr(null)
    try {
      const res = await fetch('/api/pricing/gpu/specs/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model_name: row.model_name }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(j.error ?? 'AI 생성 실패'); return }
      onSaved(); onClose()
    } finally { setGen(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(640px,100%)', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--gpu-border)', position: 'sticky', top: 0, background: '#fff' }}>
          <strong style={{ fontSize: 16, flex: 1 }}>{row.model_name} <span style={{ fontSize: 12, color: 'var(--gpu-muted)', fontWeight: 400 }}>Tier {row.tier}</span></strong>
          {row.spec?.ai_generated && <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gpu-accent)', background: 'rgba(91,94,240,.1)', borderRadius: 5, padding: '2px 7px' }}>AI 생성 {row.spec.ai_confidence != null ? `${row.spec.ai_confidence}%` : ''}</span>}
          <button onClick={onClose} className="gpu-btn" style={{ padding: 6 }}><X size={16} /></button>
        </div>
        <div style={{ padding: 20 }}>
          {!editing ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 18px' }}>
                {FIELDS.map(({ key, label }) => (
                  <div key={key as string} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, borderBottom: '1px solid #f1f3f9', padding: '4px 0' }}>
                    <span style={{ color: 'var(--gpu-muted)' }}>{label}</span>
                    <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{fmt(row.spec?.[key])}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                <button onClick={() => setEditing(true)} className="gpu-btn gpu-btn-primary" style={{ gap: 5 }}><Pencil size={14} /> 수정</button>
                <button onClick={regenerate} disabled={gen} className="gpu-btn" style={{ gap: 5, marginLeft: 'auto' }}><Sparkles size={14} /> {gen ? 'AI 생성 중…' : 'AI 재생성'}</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {FIELDS.map(({ key, label, type }) => (
                  <label key={key as string} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--gpu-muted)' }}>{label}{(key === 'vram_gb' || key === 'architecture') && <span style={{ color: 'var(--gpu-red)' }}> *</span>}</span>
                    {type === 'bool' ? (
                      <select value={form[key as string]} onChange={(e) => set(key as string, e.target.value)} style={{ height: 30, fontSize: 12.5, borderRadius: 6, border: '1.5px solid var(--gpu-border)', padding: '0 6px' }}>
                        <option value="">미상</option><option value="true">지원</option><option value="false">미지원</option>
                      </select>
                    ) : (
                      <input value={form[key as string]} onChange={(e) => set(key as string, e.target.value)} inputMode={type === 'number' ? 'decimal' : undefined}
                        style={{ height: 30, fontSize: 12.5, borderRadius: 6, border: '1.5px solid var(--gpu-border)', padding: '0 8px' }} />
                    )}
                  </label>
                ))}
              </div>
              {err && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--gpu-red)' }}>{err}</div>}
              <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                <button onClick={save} disabled={saving} className="gpu-btn gpu-btn-primary" style={{ gap: 5 }}><Save size={14} /> {saving ? '저장 중…' : '저장'}</button>
                {row.has_spec && <button onClick={() => setEditing(false)} className="gpu-btn">취소</button>}
                <button onClick={regenerate} disabled={gen} className="gpu-btn" style={{ gap: 5, marginLeft: 'auto' }}><Sparkles size={14} /> {gen ? 'AI…' : 'AI 재생성'}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function SpecsTab() {
  const { data } = useSWR<{ models: ModelRow[] }>('/api/pricing/gpu/specs', fetcher)
  const { mutate } = useSWRConfig()
  const models = data?.models ?? []
  const [open, setOpen] = useState<ModelRow | null>(null)
  const [bulkGen, setBulkGen] = useState(false)
  const [search, setSearch] = useState('')

  const refresh = () => mutate('/api/pricing/gpu/specs')
  const missing = models.filter((m) => !m.has_spec).length

  const bulkGenerate = async () => {
    if (!confirm(`스펙 없는 모델 ${missing}개를 AI로 일괄 생성할까요?`)) return
    setBulkGen(true)
    try {
      const res = await fetch('/api/pricing/gpu/specs/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) alert(j.error ?? 'AI 일괄 생성 실패')
      else alert(`AI 생성 완료: ${j.generated}/${j.total}`)
      refresh()
    } finally { setBulkGen(false) }
  }

  const filtered = search.trim() ? models.filter((m) => m.model_name.toLowerCase().includes(search.toLowerCase())) : models

  return (
    <div>
      <div className="gpu-toolbar">
        <div className="gpu-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>
          <input placeholder="GPU 모델 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="gpu-btn gpu-btn-primary" onClick={bulkGenerate} disabled={bulkGen || missing === 0} style={{ gap: 5 }}>
          <Sparkles size={15} /> {bulkGen ? 'AI 생성 중…' : `AI 일괄 생성 (스펙없음 ${missing})`}
        </button>
      </div>

      <table className="table-base table-card">
        <thead>
          <tr><th>GPU 모델</th><th>아키텍처</th><th>VRAM</th><th>FP16</th><th>TDP</th><th>상태</th></tr>
        </thead>
        <tbody>
          {filtered.map((m) => (
            <tr key={m.model_name} onClick={() => setOpen(m)} style={{ cursor: 'pointer' }}>
              <td className="card-header"><span style={{ fontWeight: 700 }}>{m.model_name}</span> <span style={{ fontSize: 11, color: 'var(--gpu-muted)' }}>T{m.tier}</span></td>
              <td data-label="아키텍처">{fmt(m.spec?.architecture)}</td>
              <td data-label="VRAM">{m.spec?.vram_gb ? `${m.spec.vram_gb}GB` : '—'}{m.spec?.vram_type ? ` ${m.spec.vram_type}` : ''}</td>
              <td data-label="FP16">{m.spec?.fp16_tflops ? `${m.spec.fp16_tflops} TF` : '—'}</td>
              <td data-label="TDP">{m.spec?.tdp_w ? `${m.spec.tdp_w}W` : '—'}</td>
              <td data-label="상태">
                {!m.has_spec
                  ? <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gpu-amber)' }}>스펙 없음</span>
                  : m.spec?.ai_generated
                    ? <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gpu-accent)' }}>AI {m.spec.ai_confidence ?? ''}%</span>
                    : m.spec?.architecture
                      ? <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gpu-green)' }}>수정됨</span>
                      : <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gpu-muted)' }}>기존값(VRAM)</span>}
              </td>
            </tr>
          ))}
          {filtered.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--gpu-faint)' }}>모델이 없습니다</td></tr>}
        </tbody>
      </table>

      {open && <SpecModal row={open} onClose={() => setOpen(null)} onSaved={refresh} />}
    </div>
  )
}
