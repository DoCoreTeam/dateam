'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { fetcher } from '@/lib/swr-config'
import { mutateGpu } from '@/lib/gpu/swr-keys'
import { useEscClose } from '@/lib/use-esc-close'
import { GPU_TERMS as T } from '@/lib/gpu/terms'
import { countryFlag } from '@/lib/gpu/country-flag'
import { Plus, X, Search, Trash2, PackagePlus, Pencil, Link2, Globe, Sparkles, GitMerge } from 'lucide-react'

interface CompetitorRow {
  id: string
  name: string
  short_name: string | null
  type: string
  region: string | null
  country: string | null
  color: string
  website_url: string | null
  pricing_url: string | null
  is_active: boolean
  supplier_id: string | null
  aliases: string[] | null
  mapping_count: number
  market_price_count: number
  is_supplier: boolean
  linked_supplier_name: string | null
}

interface MergeSuggestion {
  key: string
  reason: 'domain' | 'name'
  competitor_ids: string[]
}

const TYPE_LABEL: Record<string, string> = {
  hyperscaler: '하이퍼스케일러', specialist: '전용 서비스', marketplace: '마켓플레이스', domestic: '국내',
}

export default function CompetitorsTab({ autoCreate = false, onAutoCreateConsumed }: { autoCreate?: boolean; onAutoCreateConsumed?: () => void }) {
  const { data, error } = useSWR<{ competitors: CompetitorRow[]; merge_suggestions?: MergeSuggestion[] }>('/api/pricing/gpu/competitors', fetcher)
  const { mutate } = useSWRConfig()
  const list = data?.competitors ?? []
  const byId = useMemo(() => new Map(list.map((c) => [c.id, c])), [list])
  const suggestions = data?.merge_suggestions ?? []

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mergeTargets, setMergeTargets] = useState<CompetitorRow[] | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  // FAB '경쟁사 등록' → 진입 시 생성 모달 자동 오픈(1회) 후 신호 소비
  useEffect(() => { if (autoCreate) { setShowCreate(true); onAutoCreateConsumed?.() } }, [autoCreate]) // eslint-disable-line react-hooks/exhaustive-deps
  const [editRow, setEditRow] = useState<CompetitorRow | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = () => { mutate('/api/pricing/gpu/competitors'); mutateGpu(mutate) }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter((c) => c.name.toLowerCase().includes(q) || (c.short_name ?? '').toLowerCase().includes(q) || (c.region ?? '').toLowerCase().includes(q))
  }, [list, search])

  const allSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id))
  const toggleAll = () => {
    setSelected((prev) => {
      if (allSelected) return new Set()
      return new Set(filtered.map((c) => c.id))
    })
  }
  const toggleOne = (id: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const bulk = async (action: 'delete' | 'promote') => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    const ok = confirm(action === 'delete' ? T.confirmBulkDelete(ids.length) : T.confirmBulkAssign(ids.length))
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch('/api/pricing/gpu/competitors/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ids }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error ?? '처리 실패'); return }
      setSelected(new Set()); refresh()
    } finally { setBusy(false) }
  }

  const removeOne = async (c: CompetitorRow) => {
    if (!confirm(`'${c.name}' 경쟁사를 ${T.remove}할까요? (소프트 삭제 — 복구 가능)`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/pricing/gpu/competitors/${c.id}`, { method: 'DELETE' })
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error ?? '삭제 실패'); return }
      refresh()
    } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="gpu-toolbar">
        <div className="gpu-search">
          <Search size={16} />
          <input className="input-field" placeholder={`${T.competitor}·지역 ${T.search}`} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="gpu-btn gpu-btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={15} /> {T.competitor} {T.create}
        </button>
      </div>

      {/* 병합 제안 — 도메인/이름이 같은 회사 클러스터(과병합 방지: 토큰 겹침만으론 제안 안 함) */}
      {suggestions.length > 0 && (
        <div className="gpu-merge-suggest">
          <span className="gpu-merge-suggest-icon"><GitMerge size={15} /></span>
          <div className="gpu-merge-suggest-body">
            <strong>같은 회사로 보이는 중복 {suggestions.length}건</strong>
            {suggestions.map((s) => {
              const members = s.competitor_ids.map((id) => byId.get(id)).filter(Boolean) as CompetitorRow[]
              if (members.length < 2) return null
              return (
                <div key={s.key} className="gpu-merge-suggest-row">
                  <span className="gpu-merge-suggest-names">
                    {members.map((m) => m.name).join(' · ')}
                    <span className="gpu-merge-suggest-reason">{s.reason === 'domain' ? '같은 도메인' : '같은 이름'}</span>
                  </span>
                  <button className="gpu-btn gpu-btn-primary gpu-merge-suggest-btn" onClick={() => setMergeTargets(members)}>
                    <GitMerge size={13} /> 검토·병합
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 다중선택 액션바 */}
      {selected.size > 0 && (
        <div className="gpu-bulkbar">
          <span className="gpu-bulkbar-count">{selected.size}{T.selected}</span>
          {selected.size >= 2 && (
            <button className="gpu-btn gpu-bulkbar-btn" disabled={busy} onClick={() => {
              const members = Array.from(selected).map((id) => byId.get(id)).filter(Boolean) as CompetitorRow[]
              if (members.length >= 2) setMergeTargets(members)
            }}>
              <GitMerge size={14} /> 선택 병합
            </button>
          )}
          <button className="gpu-btn gpu-bulkbar-btn" disabled={busy} onClick={() => bulk('promote')}>
            <PackagePlus size={14} /> {T.bulkAssignSupplier}
          </button>
          <button className="gpu-btn gpu-bulkbar-btn gpu-bulkbar-btn--danger" disabled={busy} onClick={() => bulk('delete')}>
            <Trash2 size={14} /> {T.bulkDelete}
          </button>
          <button className="gpu-btn gpu-bulkbar-clear" onClick={() => setSelected(new Set())}>{T.cancel}</button>
        </div>
      )}

      {error ? (
        <div className="gpu-expand-empty">{T.loadFailed}</div>
      ) : filtered.length === 0 ? (
        <div className="gpu-expand-empty">{search.trim() ? T.noSearchResult : T.emptyList}</div>
      ) : (
        <table className="table-base table-card gpu-mgmt-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={T.selectAll} />
              </th>
              <th>{T.competitor}</th>
              <th>유형</th>
              <th className="r">모델 매핑</th>
              <th className="r">{T.marketPrice}</th>
              <th>상태</th>
              <th className="r">관리</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} className={selected.has(c.id) ? 'gpu-comp-row--sel' : ''} onClick={() => setEditRow(c)} style={{ cursor: 'pointer' }}>
                <td data-label={T.selectAll} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} aria-label={`${c.name} ${T.selected}`} />
                </td>
                <td className="card-header">
                  <span className="gpu-comp-name">
                    <span className="gpu-sdot" style={{ background: c.color }} />
                    {c.country && <span title={c.country}>{countryFlag(c.country)}</span>}
                    {c.name}
                    {c.short_name && c.short_name !== c.name && <span className="gpu-comp-short">{c.short_name}</span>}
                    {c.aliases && c.aliases.length > 0 && <span className="gpu-comp-alias" title={`병합된 표기: ${c.aliases.join(', ')}`}>+{c.aliases.length} 별칭</span>}
                    {c.website_url && <a href={c.website_url} target="_blank" rel="noreferrer" className="gpu-comp-link" onClick={(e) => e.stopPropagation()}><Globe size={11} /></a>}
                  </span>
                </td>
                <td data-label="유형">{TYPE_LABEL[c.type] ?? c.type}{c.region ? ` · ${c.region}` : ''}</td>
                <td data-label="모델 매핑" className="r gpu-mono">{c.mapping_count}</td>
                <td data-label={T.marketPrice} className="r gpu-mono">{c.market_price_count}</td>
                <td data-label="상태">
                  {c.is_supplier ? (
                    <span className="gpu-dual-badge" title={`${T.dualRole} — ${c.linked_supplier_name ?? ''}`}>
                      <Link2 size={10} /> {T.dualRole}
                    </span>
                  ) : (
                    <span className="gpu-comp-plain">{T.competitor}</span>
                  )}
                </td>
                <td data-label="관리" className="r card-actions" onClick={(e) => e.stopPropagation()}>
                  {!c.is_supplier && (
                    <button className="gpu-btn gpu-promote-btn" disabled={busy} title={T.assignSupplier}
                      onClick={async () => {
                        setBusy(true)
                        try {
                          const res = await fetch(`/api/pricing/gpu/market/competitors/${c.id}/promote-supplier`, { method: 'POST' })
                          if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error ?? '지정 실패'); return }
                          refresh()
                        } finally { setBusy(false) }
                      }}>
                      <PackagePlus size={12} /> {T.assignSupplier}
                    </button>
                  )}
                  <button className="gpu-btn gpu-icon-btn" title={T.edit} onClick={() => setEditRow(c)}><Pencil size={13} /></button>
                  <button className="gpu-btn gpu-icon-btn gpu-icon-btn--danger" title={T.remove} disabled={busy} onClick={() => removeOne(c)}><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showCreate && <CompetitorModal onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); refresh() }} />}
      {editRow && <CompetitorModal row={editRow} onClose={() => setEditRow(null)} onSaved={() => { setEditRow(null); refresh() }} />}
      {mergeTargets && <MergeModal members={mergeTargets} onClose={() => setMergeTargets(null)} onMerged={() => { setMergeTargets(null); setSelected(new Set()); refresh() }} />}
    </div>
  )
}

// 경쟁사 병합 모달 — 대표(캐노니컬) 선택 후 나머지를 흡수. 별칭 보존·매핑 이관은 서버(merge route).
function MergeModal({ members, onClose, onMerged }: { members: CompetitorRow[]; onClose: () => void; onMerged: () => void }) {
  useEscClose(onClose)
  // 기본 대표 = 데이터 많은 회사(시장가→매핑→이름 길이)
  const defaultCanonical = useMemo(() => {
    return [...members].sort((a, b) =>
      (b.market_price_count - a.market_price_count) ||
      (b.mapping_count - a.mapping_count) ||
      (b.name.length - a.name.length),
    )[0]?.id ?? members[0].id
  }, [members])
  const [canonicalId, setCanonicalId] = useState(defaultCanonical)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const merge = async () => {
    setSaving(true); setErr(null)
    try {
      const absorb_ids = members.map((m) => m.id).filter((id) => id !== canonicalId)
      const res = await fetch('/api/pricing/gpu/competitors/merge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canonical_id: canonicalId, absorb_ids }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? '병합 실패'); return }
      onMerged()
    } catch { setErr('병합 중 오류가 발생했습니다') } finally { setSaving(false) }
  }

  return (
    <div className="gpu-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="gpu-modal-card gpu-modal-card--sm" onClick={(e) => e.stopPropagation()}>
        <div className="gpu-modal-header">
          <strong className="tape-title">경쟁사 병합</strong>
          <button type="button" onClick={onClose} className="gpu-modal-close" aria-label={T.cancel}><X size={16} /></button>
        </div>
        <div className="gpu-modal-body">
          <p className="gpu-merge-hint">대표로 남길 회사를 고르세요. 나머지는 흡수되고 모델 매핑·시장가는 대표로 이관됩니다. 흡수된 표기는 별칭으로 보존됩니다.</p>
          <div className="gpu-merge-pick">
            {members.map((m) => (
              <label key={m.id} className={`gpu-merge-opt${canonicalId === m.id ? ' gpu-merge-opt--on' : ''}`}>
                <input type="radio" name="canonical" checked={canonicalId === m.id} onChange={() => setCanonicalId(m.id)} />
                <span className="gpu-merge-opt-name">
                  <span className="gpu-sdot" style={{ background: m.color }} />
                  {m.name}
                  {m.website_url && <span className="gpu-merge-opt-dom">{m.website_url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}</span>}
                </span>
                <span className="gpu-merge-opt-stat">매핑 {m.mapping_count} · 시세 {m.market_price_count}</span>
              </label>
            ))}
          </div>
          {err && <div className="gpu-link-err">{err}</div>}
          <div className="gpu-merge-actions">
            <button className="gpu-btn" onClick={onClose} disabled={saving}>{T.cancel}</button>
            <button className="gpu-btn gpu-btn-primary" onClick={merge} disabled={saving}>
              <GitMerge size={14} /> {saving ? '병합 중…' : `${members.length}개 → 1개로 병합`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// 경쟁사 등록/수정 모달
function CompetitorModal({ row, onClose, onSaved }: { row?: CompetitorRow; onClose: () => void; onSaved: () => void }) {
  useEscClose(onClose)
  const isEdit = !!row
  const [f, setF] = useState({
    name: row?.name ?? '', short_name: row?.short_name ?? '', type: row?.type ?? 'specialist',
    region: row?.region ?? '', country: row?.country ?? '', website_url: row?.website_url ?? '', pricing_url: row?.pricing_url ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const aiAuto = useRef(false)   // onBlur 자동 제안은 모달당 1회만(토큰 절약)
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }))

  // AI 회사정보 자동채움(제안) — 빈 필드만 채움(사용자 입력 보존), 저장은 사용자가. §5-3
  const aiFill = async () => {
    if (!f.name.trim() || aiBusy) return
    setAiBusy(true); setErr(null)
    try {
      const res = await fetch('/api/pricing/gpu/company-enrich', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name.trim(), website: f.website_url || null, kind: 'competitor' }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? 'AI 조회 실패'); return }
      const { result } = await res.json()
      setF((p) => ({
        ...p,
        country: p.country || (result.country ?? ''),
        type: p.type && p.type !== 'specialist' ? p.type : (result.type && TYPE_LABEL[result.type] ? result.type : p.type),
        website_url: p.website_url || (result.website ?? ''),
        pricing_url: p.pricing_url || (result.pricing_url ?? ''),
      }))
    } catch { setErr('AI 조회 실패') } finally { setAiBusy(false) }
  }

  const save = async () => {
    if (!f.name.trim()) { setErr('경쟁사명은 필수입니다'); return }
    setSaving(true); setErr(null)
    try {
      const url = isEdit ? `/api/pricing/gpu/competitors/${row!.id}` : '/api/pricing/gpu/competitors'
      const res = await fetch(url, { method: isEdit ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? '저장 실패'); return }
      onSaved()
    } finally { setSaving(false) }
  }

  return (
    <div className="gpu-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="gpu-modal-card gpu-modal-card--sm" onClick={(e) => e.stopPropagation()}>
        <div className="gpu-modal-header">
          <strong className="tape-title">{T.competitor} {isEdit ? T.edit : T.create}</strong>
          <button type="button" onClick={aiFill} disabled={aiBusy || !f.name.trim()} className="gpu-btn gpu-promote-btn" style={{ marginLeft: 'auto' }} title="회사명으로 AI가 정보를 채웁니다(빈 칸만, 편집 가능)">
            <Sparkles size={12} /> {aiBusy ? 'AI 조회중…' : 'AI로 채우기'}
          </button>
          <button type="button" onClick={onClose} className="gpu-modal-close" aria-label={T.cancel}><X size={16} /></button>
        </div>
        <div className="gpu-modal-body">
          <div className="responsive-grid-cols-2">
            <label className="gpu-field"><span className="label">경쟁사명 *</span><input className="input-field" value={f.name} onChange={(e) => set('name', e.target.value)} onBlur={() => { if (!isEdit && !aiAuto.current && f.name.trim() && !f.country && !f.website_url) { aiAuto.current = true; aiFill() } }} /></label>
            <label className="gpu-field"><span className="label">약칭</span><input className="input-field" value={f.short_name} onChange={(e) => set('short_name', e.target.value)} /></label>
            <label className="gpu-field"><span className="label">유형</span>
              <select className="input-field" value={f.type} onChange={(e) => set('type', e.target.value)}>
                {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="gpu-field"><span className="label">지역(분류)</span>
              <select className="input-field" value={f.region} onChange={(e) => set('region', e.target.value)}>
                <option value="global">global</option><option value="korea">korea</option><option value="domestic">domestic</option>
              </select>
            </label>
            <label className="gpu-field"><span className="label">국가코드 {f.country && countryFlag(f.country)}</span><input className="input-field" value={f.country} onChange={(e) => set('country', e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2))} placeholder="KR / US / JP" maxLength={2} /></label>
            <label className="gpu-field"><span className="label">웹사이트</span><input className="input-field" value={f.website_url} onChange={(e) => set('website_url', e.target.value)} /></label>
            <label className="gpu-field"><span className="label">가격 페이지 URL</span><input className="input-field" value={f.pricing_url} onChange={(e) => set('pricing_url', e.target.value)} placeholder="재수집 출처" /></label>
          </div>
          {err && <div className="gpu-link-err">{err}</div>}
          <button className="gpu-btn gpu-btn-primary" disabled={saving} onClick={save}>{saving ? `${T.save} 중…` : T.save}</button>
        </div>
      </div>
    </div>
  )
}
