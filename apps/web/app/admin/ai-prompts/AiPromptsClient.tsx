'use client'
import { Fragment, useState } from 'react'
import useSWR from 'swr'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fetcher = (u: string) => fetch(u).then((r) => r.json())

interface Prompt { id: string; prompt_key: string; version: string; active: boolean; source: string; model_hint: string | null; updated_at: string; updated_by: string | null; content: string }
interface Revision { id: string; prompt_key: string; version: string; source: string; event: string; reason: string | null; trigger: string | null; created_by: string; created_at: string }

const EVENT_LABEL: Record<string, { t: string; c: string }> = {
  auto_activated: { t: 'AI 자동반영', c: '#2563eb' }, auto_rolled_back: { t: 'AI 자동롤백', c: '#d97706' },
  rolled_back: { t: '수동 롤백', c: '#7c3aed' }, edited: { t: '수동 편집', c: '#0f172a' },
  held: { t: 'AI 보류', c: '#dc2626' }, activated: { t: '활성화', c: '#16a34a' }, deactivated: { t: '비활성화', c: '#64748b' },
}

export default function AiPromptsClient() {
  const [tab, setTab] = useState<'prompts' | 'history' | 'schema'>('prompts')
  return (
    <div className="page-inner" style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ fontSize: 12, color: '#64748b' }}>관리자 · AI</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: '0 0 4px' }}>AI 프롬프트 운영</h2>
      <p style={{ fontSize: 12.5, color: '#64748b', margin: '0 0 16px' }}>DB 프롬프트 CRUD · AI 자가갱신 이력(왜·어떻게) · 롤백 · AI가 보는 스키마</p>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid #e5e7eb' }}>
        {([['prompts', '프롬프트'], ['history', '변경 이력'], ['schema', '스키마(AI 가시)']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{ padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === k ? 700 : 500, color: tab === k ? 'var(--gpu-accent,#5b5ef0)' : '#64748b', borderBottom: tab === k ? '2px solid var(--gpu-accent,#5b5ef0)' : '2px solid transparent' }}>{label}</button>
        ))}
      </div>
      {tab === 'prompts' && <PromptsTab />}
      {tab === 'history' && <HistoryTab />}
      {tab === 'schema' && <SchemaTab />}
    </div>
  )
}

function PromptsTab() {
  const { data, mutate } = useSWR<{ prompts: Prompt[] }>('/api/admin/ai-prompts', fetcher)
  const [edit, setEdit] = useState<Prompt | null>(null)
  const [draft, setDraft] = useState('')
  const [msg, setMsg] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [instr, setInstr] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const prompts = data?.prompts ?? []
  const toggleOpen = (id: string) => setOpen((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const aiEdit = async () => {
    if (!instr.trim()) { setMsg('지시문을 입력하세요'); return }
    setAiBusy(true); setMsg('AI가 편집 중…')
    try {
      const r = await fetch('/api/admin/ai-prompts/ai-edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: draft, instruction: instr }) })
      const j = await r.json()
      if (r.ok && j.revised) { setDraft(j.revised); setMsg('AI 편집 완료 — 검토 후 저장하세요') }
      else setMsg(j.error ?? 'AI 편집 실패')
    } catch { setMsg('AI 편집 오류') } finally { setAiBusy(false) }
  }

  const save = async () => {
    if (!edit) return
    const r = await fetch('/api/admin/ai-prompts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: edit.id, content: draft }) })
    setMsg(r.ok ? '저장됨' : '실패'); if (r.ok) { setEdit(null); mutate() }
  }
  const toggle = async (p: Prompt) => {
    await fetch('/api/admin/ai-prompts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, active: !p.active }) })
    mutate()
  }

  return (
    <>
      <table className="table-base table-card" style={{ width: '100%' }}>
        <thead><tr><th>프롬프트 키</th><th>버전</th><th>출처</th><th>활성</th><th>수정</th><th></th></tr></thead>
        <tbody>
          {prompts.map((p) => (
            <Fragment key={p.id}>
              <tr>
                <td className="card-header"><span style={{ fontWeight: 600 }}>{p.prompt_key}</span></td>
                <td data-label="버전">{p.version}</td>
                <td data-label="출처"><span style={{ color: p.source === 'ai' ? '#2563eb' : '#64748b', fontWeight: p.source === 'ai' ? 700 : 400 }}>{p.source === 'ai' ? '🤖 AI' : '👤 사람'}</span></td>
                <td data-label="활성"><button onClick={() => toggle(p)} className="gpu-btn" style={{ fontSize: 11, padding: '2px 10px', color: p.active ? '#16a34a' : '#94a3b8', borderColor: p.active ? '#bbf7d0' : '#e5e7eb' }}>{p.active ? '활성' : '비활성'}</button></td>
                <td data-label="수정" className="card-hide" style={{ fontSize: 11, color: '#94a3b8' }}>{p.updated_at?.slice(0, 10)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button onClick={() => toggleOpen(p.id)} className="gpu-btn" style={{ fontSize: 11, padding: '2px 10px', marginRight: 4 }}>{open.has(p.id) ? '내용 닫기' : `내용 (${p.content?.length ?? 0}자)`}</button>
                  <button onClick={() => { setEdit(p); setDraft(p.content); setInstr(''); setMsg('') }} className="gpu-btn" style={{ fontSize: 11, padding: '2px 10px' }}>편집</button>
                </td>
              </tr>
              {open.has(p.id) && (
                <tr>
                  <td colSpan={6} style={{ background: '#f8fafc', padding: 0 }}>
                    <pre style={{ margin: 0, padding: 14, fontSize: 11.5, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#0f172a', maxHeight: 420, overflowY: 'auto' }}>{p.content}</pre>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {edit && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }} onClick={() => setEdit(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 20, width: 'min(760px, 96vw)', maxHeight: '88vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>{edit.prompt_key} <span style={{ fontSize: 12, color: '#94a3b8' }}>{edit.version}</span></h3>
            <p style={{ fontSize: 11.5, color: '#94a3b8', margin: '0 0 10px' }}>편집·저장 시 변경 이력에 기록됩니다(왜·어떻게)</p>
            {/* AI에게 편집 지시 — 스키마 인지 상태로 현재 본문을 개선해 아래 편집창에 채움(저장은 사람이) */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <input value={instr} onChange={(e) => setInstr(e.target.value)} placeholder="AI에게 지시 (예: 약정·수량 추출을 강화하고 재고 resp_qty를 더 정확히)" disabled={aiBusy}
                style={{ flex: 1, fontSize: 12, padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8 }} onKeyDown={(e) => { if (e.key === 'Enter') aiEdit() }} />
              <button onClick={aiEdit} disabled={aiBusy} className="gpu-btn" style={{ fontSize: 12, padding: '6px 14px', color: '#2563eb', borderColor: '#bfdbfe', fontWeight: 600, whiteSpace: 'nowrap' }}>{aiBusy ? '편집 중…' : '🤖 AI로 편집'}</button>
            </div>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} style={{ width: '100%', minHeight: 340, fontFamily: 'monospace', fontSize: 12, padding: 10, border: '1px solid #e5e7eb', borderRadius: 8 }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
              <button onClick={save} className="gpu-btn gpu-btn-primary">저장</button>
              <button onClick={() => setEdit(null)} className="gpu-btn">취소</button>
              {msg && <span style={{ fontSize: 12, color: '#16a34a' }}>{msg}</span>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function HistoryTab() {
  const { data, mutate } = useSWR<{ revisions: Revision[] }>('/api/admin/ai-prompts?view=history', fetcher)
  const [msg, setMsg] = useState('')
  const revs = data?.revisions ?? []
  const rollback = async (id: string) => {
    if (!confirm('이 버전으로 롤백할까요? (현재 활성본을 이 버전으로 되돌림)')) return
    const r = await fetch('/api/admin/ai-prompts/rollback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision_id: id }) })
    const j = await r.json().catch(() => ({}))
    setMsg(r.ok ? `롤백 완료 → ${j.restored}` : (j.error ?? '실패')); mutate()
  }
  return (
    <>
      {msg && <div style={{ fontSize: 12, color: '#16a34a', marginBottom: 8 }}>{msg}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {revs.length === 0 && <div style={{ fontSize: 12.5, color: '#94a3b8' }}>변경 이력 없음</div>}
        {revs.map((r) => {
          const ev = EVENT_LABEL[r.event] ?? { t: r.event, c: '#64748b' }
          return (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: '#fff', border: '1px solid #eef2f7', fontSize: 12.5 }}>
              <span style={{ fontWeight: 700, color: ev.c, minWidth: 78 }}>{ev.t}</span>
              <span style={{ fontWeight: 600 }}>{r.prompt_key}</span>
              <span style={{ color: '#94a3b8' }}>{r.version}</span>
              {r.reason && <span style={{ color: '#64748b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {r.reason}</span>}
              {r.trigger && <span style={{ fontSize: 10.5, color: '#cbd5e1' }}>{r.trigger}</span>}
              <span style={{ fontSize: 10.5, color: '#cbd5e1' }}>{r.created_at?.slice(0, 16).replace('T', ' ')}</span>
              <button onClick={() => rollback(r.id)} className="gpu-btn" style={{ fontSize: 11, padding: '2px 10px', color: '#7c3aed', borderColor: '#ddd6fe' }}>이 버전 롤백</button>
            </div>
          )
        })}
      </div>
    </>
  )
}

function SchemaTab() {
  const { data } = useSWR<{ digest: string; tables: string[] }>('/api/admin/ai-prompts?view=schema', fetcher)
  return (
    <>
      <p style={{ fontSize: 12.5, color: '#64748b', margin: '0 0 10px' }}>AI가 추출 시 인지하는 테이블 {data?.tables?.length ?? 0}개 (코멘트 <code>ai:intake</code> 태그 자동스캔, 민감테이블 제외)</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        {(data?.tables ?? []).map((t) => <span key={t} style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 999, background: '#eef2ff', color: '#4338ca', fontWeight: 600 }}>{t}</span>)}
      </div>
      <pre style={{ fontSize: 11, fontFamily: 'monospace', background: '#0f172a', color: '#e2e8f0', padding: 14, borderRadius: 10, overflowX: 'auto', maxHeight: 460 }}>{data?.digest ?? '불러오는 중…'}</pre>
    </>
  )
}
