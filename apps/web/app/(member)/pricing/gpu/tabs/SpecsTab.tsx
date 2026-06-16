'use client'

import { useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { fetcher } from '@/lib/swr-config'
import { Sparkles, X, Save, Pencil } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'
import { memoryTitle } from '@/lib/gpu/card-memory'

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
interface ConfigRow { id: string; gpu_count: number; memory: string | null; vcpu: number | null; ram_gb: number | null; storage_gb: number | null; series: string | null }
interface ModelRow { model_name: string; tier: number; memory: string | null; spec: Spec | null; has_spec: boolean; configs: ConfigRow[] }

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

// 통합 스펙 모달 — 구성별 인스턴스 스펙(가격표 등 표시값) + 칩 데이터시트를 한 화면·한 수정·한 저장·한 AI로 관리.
function SpecModal({ row, onClose, onSaved }: { row: ModelRow; onClose: () => void; onSaved: () => void }) {
  const [editing, setEditing] = useState(!row.has_spec)
  const [chip, setChip] = useState<Record<string, string>>(() => {
    const f: Record<string, string> = {}
    for (const { key } of FIELDS) { const v = row.spec?.[key]; f[key] = v === null || v === undefined ? '' : String(v) }
    return f
  })
  const [cfgs, setCfgs] = useState(() => row.configs.map((c) => ({
    id: c.id, gpu_count: c.gpu_count,
    memory: c.memory ?? '', vcpu: c.vcpu == null ? '' : String(c.vcpu),
    ram_gb: c.ram_gb == null ? '' : String(c.ram_gb), storage_gb: c.storage_gb == null ? '' : String(c.storage_gb),
  })))
  const [tier, setTier] = useState(String(row.tier))   // 수동 tier override
  const [saving, setSaving] = useState(false)
  const [gen, setGen] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const setChipF = (k: string, v: string) => setChip((p) => ({ ...p, [k]: v }))
  const setCfgF = (id: string, k: string, v: string) => setCfgs((p) => p.map((c) => c.id === id ? { ...c, [k]: v } : c))
  useEscClose(onClose)

  // 한 번의 저장 = 칩 데이터시트(gpu_specs) + 모든 구성 인스턴스 스펙(gpu_products) 동시 저장
  const saveAll = async () => {
    setSaving(true); setErr(null)
    try {
      const chipPayload: Record<string, unknown> = { model_name: row.model_name }
      for (const { key, type } of FIELDS) {
        const raw = chip[key as string]
        if (type === 'number') chipPayload[key] = raw === '' ? null : Number(raw)
        else if (type === 'bool') chipPayload[key] = raw === '' ? null : raw === 'true'
        else chipPayload[key] = raw
      }
      const r1 = await fetch('/api/pricing/gpu/specs', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chipPayload) })
      if (!r1.ok) { const j = await r1.json().catch(() => ({})); setErr(j.error ?? '칩 스펙 저장 실패'); return }
      for (const c of cfgs) {
        const r2 = await fetch(`/api/pricing/gpu/products/${c.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ memory: c.memory, vcpu: c.vcpu, ram_gb: c.ram_gb, storage_gb: c.storage_gb, tier: Number(tier) }),
        })
        if (!r2.ok) { const j = await r2.json().catch(() => ({})); setErr(j.error ?? `구성(×${c.gpu_count}) 저장 실패`); return }
      }
      onSaved(); onClose()
    } finally { setSaving(false) }
  }

  // AI 자동완성 — 부족 정보(칩 데이터시트)를 AI가 채움
  const aiFill = async () => {
    setGen(true); setErr(null)
    try {
      const res = await fetch('/api/pricing/gpu/specs/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model_name: row.model_name }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(j.error ?? 'AI 생성 실패'); return }
      onSaved(); onClose()
    } finally { setGen(false) }
  }

  const deleteSpec = async () => {
    if (!confirm(`'${row.model_name}' 칩 데이터시트를 삭제(초기화)할까요?`)) return
    const res = await fetch(`/api/pricing/gpu/specs?model_name=${encodeURIComponent(row.model_name)}`, { method: 'DELETE' })
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? '삭제 실패'); return }
    onSaved(); onClose()
  }

  const aiBtn = (
    <button onClick={aiFill} disabled={gen} className="gpu-btn" style={{ gap: 5, marginLeft: 'auto', borderColor: 'var(--gpu-accent,var(--brand))', color: 'var(--gpu-accent,var(--brand))' }}>
      <Sparkles size={14} /> {gen ? 'AI 자동완성 중…' : 'AI 자동완성 (부족정보)'}
    </button>
  )

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(680px,100%)', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: 'var(--hairline) solid var(--gpu-border)', position: 'sticky', top: 0, background: '#fff' }}>
          <strong style={{ fontSize: 16, flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            {row.model_name}
            {editing ? (
              <select value={tier} onChange={(e) => setTier(e.target.value)} title="Tier 변경 (데이터센터=1/워크스테이션=2/소비자=3)" style={{ height: 26, fontSize: 12, borderRadius: 6, border: '1.5px solid var(--gpu-border)', padding: '0 6px', fontWeight: 600 }}>
                <option value="1">Tier 1 (데이터센터)</option>
                <option value="2">Tier 2 (워크스테이션)</option>
                <option value="3">Tier 3 (소비자)</option>
              </select>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--gpu-muted)', fontWeight: 400 }}>Tier {row.tier}</span>
            )}
          </strong>
          {row.spec?.ai_generated && <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gpu-accent)', background: 'rgba(91,94,240,.1)', borderRadius: 5, padding: '2px 7px' }}>AI {row.spec.ai_confidence != null ? `${row.spec.ai_confidence}%` : ''}</span>}
          <button onClick={onClose} className="gpu-btn" style={{ padding: 6 }}><X size={16} /></button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 11.5, color: 'var(--gpu-muted)', background: 'var(--color-bg)', border: 'var(--hairline) solid var(--surface-bg)', borderRadius: 8, padding: '7px 10px' }}>
            현재 등록된 <b>{row.model_name}</b> 구성 {cfgs.length}개 — 가격표·시장비교·재고·고객판매가격표와 동일한 우리 GPU 목록입니다. 장수·카드 VRAM에 따라 별도 구성으로 등록됩니다.
          </div>
          {/* 구성별 스펙 — 카드당 VRAM으로 식별(같은 ×N 장수라도 80GB/40GB 카드는 다른 구성) */}
          {cfgs.map((c) => {
            const totalVram = c.memory ? Number(String(c.memory).replace(/[^0-9]/g, '')) : null
            const perCard = totalVram ? Math.round(totalVram / Math.max(c.gpu_count, 1)) : null
            return (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 12.5, minWidth: 96, color: 'var(--gpu-accent,var(--brand))' }} title={memoryTitle(c.memory, c.gpu_count) || '카드당 VRAM × 장수'}>{perCard ? `${perCard}GB 카드 ×${c.gpu_count}` : `×${c.gpu_count} GPU`}</span>
              {(['memory', 'vcpu', 'ram_gb', 'storage_gb'] as const).map((k) => {
                const lbl = k === 'memory' ? 'VRAM' : k === 'vcpu' ? 'vCPU' : k === 'ram_gb' ? 'RAM(GB)' : 'SSD(GB)'
                return editing ? (
                  <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <span style={{ fontSize: 10.5, color: 'var(--gpu-muted)' }}>{lbl}</span>
                    <input value={c[k]} onChange={(e) => setCfgF(c.id, k, e.target.value)} style={{ width: k === 'memory' ? 62 : 54, height: 28, fontSize: 12, borderRadius: 6, border: '1.5px solid var(--gpu-border)', padding: '0 6px' }} />
                  </span>
                ) : (
                  <span key={k} style={{ fontSize: 12 }}><span style={{ color: 'var(--gpu-muted)' }}>{lbl} </span><b>{c[k] || '—'}</b></span>
                )
              })}
            </div>
          )})}

          <div style={{ borderTop: 'var(--hairline) solid var(--surface-bg)' }} />

          {/* 나머지 스펙 항목 — 같은 통합 리스트. 부족분은 AI 자동완성 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: editing ? 10 : '8px 18px' }}>
            {FIELDS.map(({ key, label, type }) => editing ? (
              <label key={key as string} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--gpu-muted)' }}>{label}{key === 'architecture' && <span style={{ color: 'var(--gpu-red)' }}> *</span>}</span>
                {type === 'bool' ? (
                  <select value={chip[key as string]} onChange={(e) => setChipF(key as string, e.target.value)} style={{ height: 30, fontSize: 12.5, borderRadius: 6, border: '1.5px solid var(--gpu-border)', padding: '0 6px' }}>
                    <option value="">미상</option><option value="true">지원</option><option value="false">미지원</option>
                  </select>
                ) : (
                  <input value={chip[key as string]} onChange={(e) => setChipF(key as string, e.target.value)} inputMode={type === 'number' ? 'decimal' : undefined}
                    style={{ height: 30, fontSize: 12.5, borderRadius: 6, border: '1.5px solid var(--gpu-border)', padding: '0 8px' }} />
                )}
              </label>
            ) : (
              <div key={key as string} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, borderBottom: 'var(--hairline) solid var(--surface-bg)', padding: '4px 0' }}>
                <span style={{ color: 'var(--gpu-muted)' }}>{label}</span>
                <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{fmt(row.spec?.[key])}</span>
              </div>
            ))}
          </div>

          {err && <div style={{ fontSize: 12, color: 'var(--gpu-red)' }}>{err}</div>}

          {/* 통합 액션 — 한 화면, 한 수정/저장, AI 자동완성 */}
          <div style={{ display: 'flex', gap: 8, paddingTop: 4, borderTop: 'var(--hairline) solid var(--gpu-border)', marginTop: 2 }}>
            {!editing ? (
              <>
                <button onClick={() => setEditing(true)} className="gpu-btn gpu-btn-primary" style={{ gap: 5 }}><Pencil size={14} /> 수정</button>
                {row.spec?.architecture && <button onClick={deleteSpec} className="gpu-btn" style={{ gap: 4, color: 'var(--gpu-red)' }}><X size={13} /> 스펙 삭제</button>}
                {aiBtn}
              </>
            ) : (
              <>
                <button onClick={saveAll} disabled={saving} className="gpu-btn gpu-btn-primary" style={{ gap: 5 }}><Save size={14} /> {saving ? '저장 중…' : '저장'}</button>
                {row.has_spec && <button onClick={() => setEditing(false)} className="gpu-btn">취소</button>}
                {aiBtn}
              </>
            )}
          </div>
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
  const [bulkProg, setBulkProg] = useState<{ done: number; total: number; current: string; log: string } | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'default', dir: 'asc' })

  const refresh = () => mutate('/api/pricing/gpu/specs')
  // 부족 정보 = 칩 데이터시트(아키텍처) 미보유 모델 (VRAM만 시드된 것 포함)
  const missing = models.filter((m) => !m.spec?.architecture).length

  // 일괄 생성 — SSE 실시간 진행(어떤 모델/몇 번째). 각 모델은 즉시 DB 저장 → 중단돼도 처리분 보존.
  const bulkGenerate = async () => {
    if (!confirm(`데이터시트 부족 모델 ${missing}개를 AI로 일괄 채울까요?`)) return
    setBulkGen(true); setBulkProg({ done: 0, total: missing, current: '', log: '' })
    let lastDone = 0; let lastTotal = missing; let completed = false
    try {
      const res = await fetch('/api/pricing/gpu/specs/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true, stream: true }),
      })
      if (!res.ok || !res.body) { alert('AI 일괄 생성 시작 실패'); return }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
      while (!completed) {
        const { done, value } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true })
        const chunks = buf.split('\n\n'); buf = chunks.pop() ?? ''
        for (const c of chunks) {
          const ev = c.match(/event: (.+)/)?.[1]?.trim(); const dm = c.match(/data: (.+)/)?.[1]
          if (!ev || !dm) continue
          let d: Record<string, unknown> = {}; try { d = JSON.parse(dm) } catch { continue }
          if (ev === 'start') { lastTotal = Number(d.total) || missing; setBulkProg({ done: 0, total: lastTotal, current: '', log: '' }) }
          else if (ev === 'progress') { lastDone = Number(d.done) || lastDone; lastTotal = Number(d.total) || lastTotal; setBulkProg({ done: lastDone, total: lastTotal, current: String(d.model ?? ''), log: String(d.msg ?? '') }) }
          else if (ev === 'complete') { completed = true; setBulkProg(null); refresh(); alert(`AI 생성 완료: ${d.generated}/${d.total}`) }
        }
      }
      reader.cancel().catch(() => {})
      refresh()
      // 정상 complete 없이 끝남(중단/타임아웃) — 부분 성공 안내(처리분은 이미 저장됨)
      if (!completed) alert(lastDone > 0 ? `생성 중단됨 — ${lastDone}/${lastTotal}개는 저장되었습니다. 남은 모델은 다시 '일괄 채우기'를 눌러 이어서 생성하세요.` : 'AI 일괄 생성 실패 (생성된 항목 없음)')
    } catch {
      refresh()
      // 예외(연결 끊김 등) — 처리분은 저장됨. 부분 성공 안내.
      alert(lastDone > 0 ? `생성 중단됨 — ${lastDone}/${lastTotal}개는 저장되었습니다. 남은 모델은 다시 '일괄 채우기'를 눌러 이어서 생성하세요.` : 'AI 일괄 생성 실패 — 네트워크를 확인하고 다시 시도하세요.')
    } finally { setBulkGen(false); setBulkProg(null) }
  }

  const filtered = search.trim() ? models.filter((m) => m.model_name.toLowerCase().includes(search.toLowerCase())) : models

  // 정렬 — 상태값(완성도)은 스펙없음<기존값<AI<수정됨 순서로 가중치
  const statusRank = (m: ModelRow): number => {
    if (!m.has_spec) return 0
    if (m.spec?.ai_generated) return 2
    if (m.spec?.architecture) return 3
    return 1
  }
  const sorted = (() => {
    if (sort.key === 'default') return filtered
    const dir = sort.dir === 'asc' ? 1 : -1
    const val = (m: ModelRow): number | string => {
      switch (sort.key) {
        case 'model': return m.model_name.toLowerCase()
        case 'tier': return m.tier
        case 'configs': return m.configs.length
        case 'arch': return (m.spec?.architecture ?? '').toLowerCase()
        case 'fp16': return m.spec?.fp16_tflops ?? -1
        case 'status': return statusRank(m)
        default: return 0
      }
    }
    return [...filtered].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      return a.model_name.localeCompare(b.model_name)
    })
  })()
  const toggleSort = (key: string) => setSort((s) => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
  const arrow = (key: string) => sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''

  return (
    <div>
      <div className="gpu-toolbar">
        <div className="gpu-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>
          <input placeholder="GPU 모델 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="gpu-btn gpu-btn-primary" onClick={bulkGenerate} disabled={bulkGen || missing === 0} style={{ gap: 5 }}>
          <Sparkles size={15} /> {bulkGen ? (bulkProg ? `생성 중 ${bulkProg.done}/${bulkProg.total}` : 'AI 생성 중…') : `AI 일괄 채우기 (부족 ${missing})`}
        </button>
      </div>

      {/* 일괄 생성 실시간 진행 */}
      {bulkProg && (
        <div style={{ margin: '0 0 12px', padding: '10px 14px', borderRadius: 10, background: 'var(--color-bg)', border: 'var(--border-w-2) solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Sparkles size={14} className="gpu-analyzing-icon" style={{ color: 'var(--gpu-accent)' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gpu-accent)' }}>AI 데이터시트 생성 중 — {bulkProg.done}/{bulkProg.total}</span>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{bulkProg.current}</span>
          </div>
          <div style={{ height: 6, borderRadius: 4, background: 'var(--color-border)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${bulkProg.total ? Math.round((bulkProg.done / bulkProg.total) * 100) : 0}%`, background: 'var(--gpu-accent)', transition: 'width .3s' }} />
          </div>
          {bulkProg.log && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>{bulkProg.log}</div>}
        </div>
      )}

      <table className="table-base table-card">
        <thead>
          <tr>
            <th onClick={() => toggleSort('model')} style={{ cursor: 'pointer', userSelect: 'none' }}>GPU 모델{arrow('model')}</th>
            <th onClick={() => toggleSort('tier')} style={{ cursor: 'pointer', userSelect: 'none' }}>Tier{arrow('tier')}</th>
            <th onClick={() => toggleSort('configs')} style={{ cursor: 'pointer', userSelect: 'none' }}>구성{arrow('configs')}</th>
            <th>VRAM · vCPU · RAM · SSD</th>
            <th onClick={() => toggleSort('arch')} style={{ cursor: 'pointer', userSelect: 'none' }}>아키텍처{arrow('arch')}</th>
            <th onClick={() => toggleSort('fp16')} style={{ cursor: 'pointer', userSelect: 'none' }}>FP16{arrow('fp16')}</th>
            <th onClick={() => toggleSort('status')} style={{ cursor: 'pointer', userSelect: 'none' }}>상태{arrow('status')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => {
            const base = m.configs[0]
            const inst = base ? [base.memory ? `VRAM ${base.memory}` : null, base.vcpu ? `${base.vcpu} vCPU` : null, base.ram_gb ? `${base.ram_gb}GB RAM` : null, base.storage_gb ? `${base.storage_gb}GB SSD` : null].filter(Boolean).join(' · ') : '—'
            return (
            <tr key={m.model_name} onClick={() => setOpen(m)} style={{ cursor: 'pointer' }}>
              <td className="card-header"><span style={{ fontWeight: 700 }}>{m.model_name}</span></td>
              <td data-label="Tier"><span style={{ fontSize: 11, color: 'var(--gpu-muted)' }}>T{m.tier}</span></td>
              <td data-label="구성">{m.configs.length}개</td>
              <td data-label="표시 스펙" style={{ fontSize: 11.5 }}>{inst || '—'}</td>
              <td data-label="아키텍처">{fmt(m.spec?.architecture)}</td>
              <td data-label="FP16">{m.spec?.fp16_tflops ? `${m.spec.fp16_tflops} TF` : '—'}</td>
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
          )})}
          {filtered.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--gpu-faint)' }}>모델이 없습니다</td></tr>}
        </tbody>
      </table>

      {open && <SpecModal row={open} onClose={() => setOpen(null)} onSaved={refresh} />}
    </div>
  )
}
