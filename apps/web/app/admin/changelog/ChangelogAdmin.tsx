'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Pencil, Trash2, DownloadCloud, X, Eye, EyeOff, Sparkles } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'
import type { ChangeType, ChangeItem } from '@/lib/changelog/types'

interface Row {
  id: string
  version: string
  released_at: string | null
  title: string | null
  changes: ChangeItem[]
  type: ChangeType
  is_published: boolean
  sort_order: number | null
}
interface Meta { total: number; page: number; limit: number }

const TYPE_OPTS: { v: ChangeType; label: string }[] = [
  { v: 'feature', label: '기능' }, { v: 'fix', label: '수정' }, { v: 'improve', label: '개선' },
]
const TYPE_BG: Record<ChangeType, string> = { feature: 'var(--success)', fix: 'var(--info)', improve: 'var(--warning)' }
const LIMIT = 20

export default function ChangelogAdmin() {
  const router = useRouter()
  const sp = useSearchParams()
  const q = sp.get('q') ?? ''
  const type = sp.get('type') ?? ''
  const published = sp.get('published') ?? ''
  const sort = sp.get('sort') ?? 'released_at'
  const dir = sp.get('dir') ?? 'desc'
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)

  const [rows, setRows] = useState<Row[] | null>(null)
  const [meta, setMeta] = useState<Meta>({ total: 0, page: 1, limit: LIMIT })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [editing, setEditing] = useState<Partial<Row> | null>(null)
  const [searchInput, setSearchInput] = useState(q)

  // "AI 정제"로 열렸을 때 모달 마운트 시 1회 자동 정제. 가드 ref를 부모(언마운트 없음)에 두어
  // StrictMode 이중 마운트에서도 정확히 1회만 fire(자식 ref는 remount 시 리셋되어 중복 가능).
  const autoRefineClaim = useRef(false)
  const claimAutoRefine = useCallback(() => {
    if (autoRefineClaim.current) { autoRefineClaim.current = false; return true }
    return false
  }, [])
  const openEdit = useCallback((r: Partial<Row>, refine = false) => { autoRefineClaim.current = refine; setEditing(r) }, [])
  const closeEdit = useCallback(() => { autoRefineClaim.current = false; setEditing(null) }, [])

  const setParam = useCallback((patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') p.delete(k); else p.set(k, v) }
    router.replace(`/admin/changelog?${p.toString()}`)
  }, [sp, router])

  const load = useCallback(async () => {
    setError('')
    const p = new URLSearchParams({ sort, dir, page: String(page), limit: String(LIMIT) })
    if (q) p.set('q', q); if (type) p.set('type', type); if (published) p.set('published', published)
    try {
      const res = await fetch(`/api/admin/changelog?${p.toString()}`)
      const j = await res.json()
      if (!res.ok) { setError(j.error ?? '목록을 불러오지 못했습니다'); setRows([]); return }
      setRows(j.items as Row[]); setMeta(j.meta as Meta)
    } catch { setError('서버 연결 실패'); setRows([]) }
  }, [q, type, published, sort, page, dir])

  useEffect(() => { load() }, [load])

  // page > 총페이지 진입(수동 URL 등) 시 마지막 페이지로 자동 복귀 — stuck 방지.
  useEffect(() => {
    const tp = Math.max(1, Math.ceil(meta.total / meta.limit))
    if (meta.total > 0 && page > tp) setParam({ page: String(tp) })
  }, [meta, page, setParam])

  const importGit = useCallback(async () => {
    setBusy(true); setMsg(''); setError('')
    try {
      // 소스는 서버 번들(source.generated.json) — body 불필요(공개노출 없음).
      const res = await fetch('/api/admin/changelog/import', { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error ?? '가져오기 실패'); return }
      setMsg(`가져오기 완료 — 신규 ${j.inserted}건(초안) 추가, 기존 버전은 유지됩니다.`)
      load()
    } catch { setError('가져오기 실패') } finally { setBusy(false) }
  }, [load])

  const togglePublish = useCallback(async (r: Row) => {
    const res = await fetch(`/api/admin/changelog/${r.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_published: !r.is_published }),
    })
    if (res.ok) load(); else setError((await res.json().catch(() => ({}))).error ?? '변경 실패')
  }, [load])

  const remove = useCallback(async (r: Row) => {
    if (!confirm(`v${r.version} 항목을 삭제할까요?`)) return
    const res = await fetch(`/api/admin/changelog/${r.id}`, { method: 'DELETE' })
    if (res.ok) load(); else setError('삭제 실패')
  }, [load])

  const totalPages = Math.max(1, Math.ceil(meta.total / meta.limit))

  return (
    <div>
      {/* 툴바 */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <form onSubmit={(e) => { e.preventDefault(); setParam({ q: searchInput || null, page: null }) }} style={{ display: 'flex', gap: 'var(--space-1)' }}>
          <input className="input-field" placeholder="버전·제목 검색" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={{ width: 180 }} />
          <button type="submit" className="gpu-btn">검색</button>
        </form>
        <select className="input-field" value={type} onChange={(e) => setParam({ type: e.target.value || null, page: null })} style={{ width: 110 }}>
          <option value="">전체 유형</option>
          {TYPE_OPTS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
        </select>
        <select className="input-field" value={published} onChange={(e) => setParam({ published: e.target.value || null, page: null })} style={{ width: 120 }}>
          <option value="">전체 상태</option>
          <option value="true">게시됨</option>
          <option value="false">초안</option>
        </select>
        <select className="input-field" value={`${sort}:${dir}`} onChange={(e) => { const [s, d] = e.target.value.split(':'); setParam({ sort: s, dir: d }) }} style={{ width: 150 }}>
          <option value="released_at:desc">날짜 최신순</option>
          <option value="released_at:asc">날짜 오래된순</option>
          <option value="version:desc">버전 내림차순</option>
          <option value="version:asc">버전 오름차순</option>
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
          <button className="gpu-btn" onClick={importGit} disabled={busy}><DownloadCloud size={14} /> {busy ? '가져오는 중…' : 'git에서 가져오기'}</button>
          <button className="gpu-btn gpu-btn-primary" onClick={() => openEdit({ type: 'feature', changes: [], is_published: false })}><Plus size={14} /> 추가</button>
        </div>
      </div>

      {msg && <div className="gpu-success-msg" style={{ marginBottom: 'var(--space-2)' }}>✓ {msg}</div>}
      {error && <div className="gpu-error-msg" style={{ marginBottom: 'var(--space-2)' }}>✕ {error}</div>}

      {/* 목록 */}
      {rows === null ? (
        <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-muted)' }}>불러오는 중…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-faint)' }}>항목이 없습니다. &quot;git에서 가져오기&quot; 또는 &quot;추가&quot;로 시작하세요.</div>
      ) : (
        <table className="table-base table-card">
          <thead>
            <tr><th>버전</th><th>날짜</th><th>제목</th><th>유형</th><th>상태</th><th>작업</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="card-header"><span style={{ fontWeight: 700 }}>v{r.version}</span></td>
                <td data-label="날짜">{r.released_at ?? '—'}</td>
                <td data-label="제목" style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title ?? `${r.changes.length}개 변경`}</td>
                <td data-label="유형"><span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: '#fff', background: TYPE_BG[r.type], borderRadius: 'var(--radius)', padding: '1px var(--space-2)' }}>{TYPE_OPTS.find((t) => t.v === r.type)?.label}</span></td>
                <td data-label="상태">
                  <button className="gpu-btn" onClick={() => togglePublish(r)} title={r.is_published ? '게시됨 — 클릭해 숨김' : '초안 — 클릭해 게시'} style={{ gap: 4, color: r.is_published ? 'var(--success)' : 'var(--text-faint)' }}>
                    {r.is_published ? <Eye size={14} /> : <EyeOff size={14} />} {r.is_published ? '게시' : '초안'}
                  </button>
                </td>
                <td data-label="작업" className="card-actions">
                  <button className="gpu-btn" onClick={() => openEdit(r, true)} title="AI 정제 — 커밋 원문을 사용자 친화 문구로 다듬어 미리보기" style={{ gap: 4, color: 'var(--brand)' }}><Sparkles size={14} /> AI 정제</button>
                  <button className="gpu-btn" onClick={() => openEdit(r)} title="수정"><Pencil size={14} /></button>
                  <button className="gpu-btn" onClick={() => remove(r)} title="삭제" style={{ color: 'var(--danger)' }}><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 페이지네이션 */}
      {rows && rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
          <button className="gpu-btn" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) })}>이전</button>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{page} / {totalPages} (총 {meta.total})</span>
          <button className="gpu-btn" disabled={page >= totalPages} onClick={() => setParam({ page: String(page + 1) })}>다음</button>
        </div>
      )}

      {editing && <EditModal row={editing} claimAutoRefine={claimAutoRefine} onClose={closeEdit} onSaved={() => { closeEdit(); load() }} onError={setError} />}
    </div>
  )
}

function EditModal({ row, claimAutoRefine, onClose, onSaved, onError }: { row: Partial<Row>; claimAutoRefine?: () => boolean; onClose: () => void; onSaved: () => void; onError: (m: string) => void }) {
  useEscClose(onClose)
  const isNew = !row.id
  const [version, setVersion] = useState(row.version ?? '')
  const [releasedAt, setReleasedAt] = useState(row.released_at ?? '')
  const [title, setTitle] = useState(row.title ?? '')
  const [type, setType] = useState<ChangeType>(row.type ?? 'feature')
  const [changesText, setChangesText] = useState((row.changes ?? []).map((c) => c.text).join('\n'))
  const [isPublished, setIsPublished] = useState(row.is_published ?? false)
  const [saving, setSaving] = useState(false)
  const [refining, setRefining] = useState(false)

  // AI 정제 — 현재 원문(변경사항 줄 + 제목)을 기능 단위 사용자 친화 콘텐츠로 다듬어 미리보기로 채움(저장 X).
  const runRefine = async () => {
    const rawLines = [title, ...changesText.split('\n')].map((l) => l.trim()).filter(Boolean)
    if (rawLines.length === 0) { onError('정제할 원문이 없습니다(변경사항을 먼저 입력하거나 가져오기 하세요)'); return }
    setRefining(true)
    try {
      const res = await fetch('/api/admin/changelog/refine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: version.trim(), rawLines }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { onError(j.error ?? 'AI 정제 실패'); return }
      const r = j.refined as { title?: string; changes?: { text: string; type: ChangeType }[] }
      if (r.title) setTitle(r.title)
      if (r.changes?.length) {
        setChangesText(r.changes.map((c) => c.text).join('\n'))
        setType(r.changes[0].type)
      }
    } catch { onError('AI 정제 실패') } finally { setRefining(false) }
  }

  // 리스트의 "AI 정제" 버튼으로 열렸으면 모달 마운트 시 1회 자동 정제(원클릭 UX).
  // 가드는 부모 ref(claimAutoRefine)가 보장 — StrictMode 이중 마운트에도 1회만 fire.
  useEffect(() => {
    if (claimAutoRefine?.()) runRefine()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = async () => {
    if (!version.trim()) { onError('버전은 필수입니다'); return }
    setSaving(true)
    const changes: ChangeItem[] = changesText.split('\n').map((l) => l.trim()).filter(Boolean).map((text) => ({ text, type }))
    const payload = { version: version.trim(), released_at: releasedAt || null, title: title.trim() || null, type, changes, is_published: isPublished }
    try {
      const res = await fetch(isNew ? '/api/admin/changelog' : `/api/admin/changelog/${row.id}`, {
        method: isNew ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { onError(j.error ?? '저장 실패'); return }
      onSaved()
    } catch { onError('저장 실패') } finally { setSaving(false) }
  }

  return (
    <div onClick={onClose} className="modal-backdrop">
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="업데이트 항목 편집" className="modal-card" style={{ width: 'min(520px,100%)', maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-4) var(--space-5)', borderBottom: 'var(--hairline) solid var(--border-color)' }}>
          <span className="tape-title" style={{ fontSize: 'var(--fs-lg)' }}>{isNew ? '업데이트 추가' : `v${row.version} 수정`}</span>
          <button onClick={onClose} aria-label="닫기" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>
        <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div><label className="label">버전 *</label><input className="input-field" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="0.7.197" /></div>
          <div><label className="label">날짜</label><input className="input-field" type="date" value={releasedAt} onChange={(e) => setReleasedAt(e.target.value)} /></div>
          <div><label className="label">제목(요약)</label><input className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><label className="label">유형</label>
            <select className="input-field" value={type} onChange={(e) => setType(e.target.value as ChangeType)}>
              {TYPE_OPTS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
              <label className="label" style={{ margin: 0 }}>변경사항 (한 줄에 하나)</label>
              <button type="button" className="gpu-btn" onClick={runRefine} disabled={refining} title="커밋 원문을 기능 단위 사용자 친화 문구로 다듬습니다(게시된 내역 톤 참고)" style={{ gap: 4, color: 'var(--brand)' }}>
                <Sparkles size={13} /> {refining ? 'AI 정제 중…' : 'AI 정제'}
              </button>
            </div>
            <textarea className="input-field" rows={5} value={changesText} onChange={(e) => setChangesText(e.target.value)} placeholder={'단일 드롭존 통합\nmultipart 전송으로 업로드 실패 해소'} style={{ marginTop: 'var(--space-1)' }} />
            <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)', marginTop: 'var(--space-1)' }}>AI 정제는 미리보기입니다 — 결과를 검토·수정 후 저장하세요.</div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--fs-sm)', cursor: 'pointer' }}>
            <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} style={{ accentColor: 'var(--brand)' }} /> 게시(사용자에게 노출)
          </label>
          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
            <button className="gpu-btn" onClick={onClose}>취소</button>
            <button className="gpu-btn gpu-btn-primary" onClick={save} disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
