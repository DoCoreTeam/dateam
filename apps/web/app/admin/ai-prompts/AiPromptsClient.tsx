'use client'

// app/admin/ai-prompts/AiPromptsClient.tsx — AI 프롬프트 운영
//
// 표현을 표준으로 옮겼다: 제목 PageHeader(§2-3) · 탭 SegmentedTabs(§2) ·
// 표 ListSurface + ListToolbar + ListPager(§2-6) · 모달 §2-2 · 폼 input-field/label(§2-1).
// 조회(SWR)와 저장·롤백 API 호출은 그대로다.

import { useState } from 'react'
import useSWR from 'swr'
import { X } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import EmptyState from '@/components/ui/EmptyState'
import { SkelCard } from '@/components/ui/LoadingSkeleton'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import { rangeOf, type ListDefaults } from '@/lib/ui/list-query'
import { useEscClose } from '@/lib/use-esc-close'
import { isEnterKey } from '@/lib/ui/ime'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fetcher = (u: string) => fetch(u).then((r) => r.json())

interface Prompt { id: string; prompt_key: string; version: string; active: boolean; source: string; model_hint: string | null; updated_at: string; updated_by: string | null; content: string }
interface Revision { id: string; prompt_key: string; version: string; source: string; event: string; reason: string | null; trigger: string | null; diff_summary: string | null; prev_content: string | null; content: string | null; created_by: string; created_at: string }

const TRIGGER_LABEL: Record<string, string> = {
  empty_extraction: '추출 0건(준비된 규칙으로 못 뽑음)', low_confidence: '추출 신뢰도 낮음',
  gate_blocked: '검증 게이트 다수 차단', live_degraded: '활성 후 품질 급락', manual: '관리자 수동',
}

// 버전 표시 통일 — 앞의 v/V 접두 제거
const fmtVer = (v: string) => (v ?? '').replace(/^v/i, '')

// 간단 라인 diff — 이전에만 있던 줄(삭제)·현재에만 있는 줄(추가) 표시
function lineDiff(before: string, after: string) {
  const b = before.split('\n'), a = after.split('\n')
  const bSet = new Set(b), aSet = new Set(a)
  const removed = b.filter((l) => !aSet.has(l))
  const added = a.filter((l) => !bSet.has(l))
  return { removed, added }
}

const EVENT_LABEL: Record<string, { t: string; c: string }> = {
  auto_activated: { t: 'AI 자동반영', c: 'var(--info)' }, auto_rolled_back: { t: 'AI 자동롤백', c: 'var(--warning)' },
  rolled_back: { t: '수동 롤백', c: 'var(--brand)' }, edited: { t: '수동 편집', c: 'var(--text)' },
  held: { t: 'AI 보류', c: 'var(--danger)' }, activated: { t: '활성화', c: 'var(--success)' }, deactivated: { t: '비활성화', c: 'var(--text-muted)' },
}

const CODE_BLOCK: React.CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-2xs)',
  fontFamily: 'monospace',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  color: 'var(--text)',
  maxHeight: '320px',
  overflowY: 'auto',
  backgroundColor: 'var(--surface-bg)',
  border: 'var(--hairline) solid var(--border-light)',
  borderRadius: 'var(--radius)',
  padding: 'var(--space-3)',
}

type TabId = 'prompts' | 'history' | 'schema'

export default function AiPromptsClient() {
  const [tab, setTab] = useState<TabId>('prompts')
  const tabs = [
    { id: 'prompts', label: '프롬프트' },
    { id: 'history', label: '변경 이력' },
    { id: 'schema', label: '스키마(AI 가시)' },
  ]
  return (
    <div>
      <PageHeader
        title="AI 프롬프트 운영"
        description="DB 프롬프트 CRUD · AI 자가갱신 이력(왜·어떻게) · 롤백 · AI가 보는 스키마"
        below={<SegmentedTabs ariaLabel="AI 프롬프트 분류" tabs={tabs} activeId={tab} onSelect={(id) => setTab(id as TabId)} />}
      />
      {tab === 'prompts' && <PromptsTab />}
      {tab === 'history' && <HistoryTab />}
      {tab === 'schema' && <SchemaTab />}
    </div>
  )
}

const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'prompt_key', dir: 'asc' },
  view: 'table',
  size: 20,
}

const SORT_OPTIONS = [
  { key: 'prompt_key', label: '프롬프트 키' },
  { key: 'updated_at', label: '수정일' },
]

function PromptsTab() {
  const { data, isLoading, mutate } = useSWR<{ prompts: Prompt[] }>('/api/admin/ai-prompts', fetcher)
  const { data: schemaData } = useSWR<{ tables: string[] }>('/api/admin/ai-prompts?view=schema', fetcher)
  const schemaTables = schemaData?.tables ?? []
  const { query, set } = useListQuery(LIST_DEFAULTS, { persistKey: '/admin/ai-prompts' })
  const [edit, setEdit] = useState<Prompt | null>(null)
  const [draft, setDraft] = useState('')
  const [msg, setMsg] = useState('')
  const [instr, setInstr] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const prompts = data?.prompts ?? []

  useEscClose(() => setEdit(null), edit != null)

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

  const columns: ColumnDef<Prompt>[] = [
    {
      key: 'prompt_key', header: '프롬프트 키', primary: true, sortable: 'prompt_key',
      cell: (p) => <span style={{ fontWeight: 600 }}>{p.prompt_key}</span>,
    },
    { key: 'version', header: '버전', cell: (p) => fmtVer(p.version) },
    {
      key: 'source', header: '출처',
      cell: (p) => (
        <span style={{ color: p.source === 'ai' ? 'var(--info)' : 'var(--text-muted)', fontWeight: p.source === 'ai' ? 700 : 400 }}>
          {p.source === 'ai' ? '🤖 AI' : '👤 사람'}
        </span>
      ),
    },
    {
      key: 'active', header: '활성',
      cell: (p) => (
        <button type="button" onClick={() => toggle(p)} className="btn-ghost"
          style={{ color: p.active ? 'var(--success)' : 'var(--text-faint)', borderColor: p.active ? 'var(--success-border)' : 'var(--border-color)' }}>
          {p.active ? '활성' : '비활성'}
        </button>
      ),
    },
    {
      key: 'updated_at', header: '수정', sortable: 'updated_at', hideOnCard: true,
      cell: (p) => (
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>
          {p.updated_at?.slice(0, 16).replace('T', ' ')}{p.updated_by ? ` · ${p.updated_by}` : ''}
        </span>
      ),
    },
    {
      key: 'content', header: '내용', width: '260px',
      cell: (p) => (
        <details>
          <summary style={{ fontSize: 'var(--fs-xs)', color: 'var(--brand)', cursor: 'pointer' }}>
            본문 보기 ({p.content?.length ?? 0}자)
          </summary>
          <pre style={{ ...CODE_BLOCK, marginTop: 'var(--space-2)' }}>{p.content}</pre>
        </details>
      ),
    },
    {
      key: 'edit', header: '편집', width: '90px',
      cell: (p) => (
        <button type="button" className="btn-ghost" onClick={() => { setEdit(p); setDraft(p.content); setInstr(''); setMsg('') }}>편집</button>
      ),
    },
  ]

  const q = query.q.trim().toLowerCase()
  const filtered = prompts
    .filter((p) => (q ? p.prompt_key.toLowerCase().includes(q) : true))
    .sort((a, b) => {
      const cmp = query.sort.key === 'updated_at'
        ? (a.updated_at ?? '').localeCompare(b.updated_at ?? '')
        : a.prompt_key.localeCompare(b.prompt_key)
      return query.sort.dir === 'asc' ? cmp : -cmp
    })

  const { from, to } = rangeOf(query)
  const rows = filtered.slice(from, to + 1)

  return (
    <>
      <div className="card card-flush">
        <ListToolbar
          query={query}
          onChange={set}
          searchPlaceholder="프롬프트 키 검색"
          sortOptions={SORT_OPTIONS}
          total={filtered.length}
        />
        <ListSurface
          rows={rows}
          columns={columns}
          query={query}
          rowKey={(p) => p.id}
          onChange={set}
          loading={isLoading}
          empty={q
            ? { title: '조건에 맞는 프롬프트가 없어요', description: '검색어를 바꿔보세요' }
            : { title: '등록된 프롬프트가 없어요', description: 'AI 추출이 처음 실행되면 프롬프트가 생성됩니다' }}
        />
        <ListPager query={query} total={filtered.length} onChange={set} />
      </div>

      {edit && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${edit.prompt_key} 편집`}
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'var(--modal-backdrop)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 'var(--z-modal)', padding: 'var(--space-5)',
          }}
          onClick={() => setEdit(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)',
              padding: 'var(--space-5)', width: 'min(760px, 96vw)', maxHeight: '88vh', overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
              <h2 className="tape-title" style={{ margin: 0 }}>{edit.prompt_key}</h2>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{fmtVer(edit.version)}</span>
              <button type="button" onClick={() => setEdit(null)} className="btn-ghost" aria-label="닫기" style={{ marginLeft: 'auto' }}>
                <X size={18} />
              </button>
            </div>
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', margin: '0 0 var(--space-3)' }}>
              편집·저장 시 변경 이력에 기록됩니다(왜·어떻게)
            </p>

            {/* AI에게 편집 지시 — 스키마 인지 상태로 현재 본문을 개선해 아래 편집창에 채움(저장은 사람이) */}
            <label className="label" htmlFor="ai-prompt-instruction">AI 편집 지시</label>
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
              <input id="ai-prompt-instruction" className="input-field" value={instr} onChange={(e) => setInstr(e.target.value)}
                placeholder="AI에게 지시 (예: 약정·수량 추출을 강화하고 재고 resp_qty를 더 정확히)" disabled={aiBusy}
                style={{ flex: 1 }} onKeyDown={(e) => { if (isEnterKey(e)) aiEdit() }} />
              <button type="button" onClick={aiEdit} disabled={aiBusy} className="btn-ghost"
                style={{ color: 'var(--info)', borderColor: 'var(--info-border)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {aiBusy ? '편집 중…' : '🤖 AI로 편집'}
              </button>
            </div>
            <div title={schemaTables.join(', ')} style={{ fontSize: 'var(--fs-2xs)', color: 'var(--info)', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
              🗂 AI는 현재 DB 스키마 <strong>{schemaTables.length}개 테이블</strong>을 참고해 수정합니다 (마우스 올리면 목록)
            </div>

            <label className="label" htmlFor="ai-prompt-body">프롬프트 본문</label>
            <textarea id="ai-prompt-body" className="input-field" value={draft} onChange={(e) => setDraft(e.target.value)}
              style={{ width: '100%', minHeight: '340px', fontFamily: 'monospace' }} />

            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', alignItems: 'center' }}>
              <button type="button" onClick={save} className="btn-primary">저장</button>
              <button type="button" onClick={() => setEdit(null)} className="btn-ghost">취소</button>
              {msg && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--success)' }}>{msg}</span>}
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
  const [open, setOpen] = useState<Set<string>>(new Set())
  const revs = data?.revisions ?? []
  const toggle = (id: string) => setOpen((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const rollback = async (id: string) => {
    if (!confirm('이 버전으로 롤백할까요? (현재 활성본을 이 버전으로 되돌림)')) return
    const r = await fetch('/api/admin/ai-prompts/rollback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision_id: id }) })
    const j = await r.json().catch(() => ({}))
    setMsg(r.ok ? `롤백 완료 → ${j.restored}` : (j.error ?? '실패')); mutate()
  }

  if (revs.length === 0) {
    return <EmptyState title="변경 이력이 없어요" description="프롬프트를 편집하거나 AI가 자가갱신하면 여기에 기록됩니다" />
  }

  return (
    <>
      {msg && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--success)', marginBottom: 'var(--space-2)' }}>{msg}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {revs.map((r) => {
          const ev = EVENT_LABEL[r.event] ?? { t: r.event, c: 'var(--text-muted)' }
          const isOpen = open.has(r.id)
          const diff = r.prev_content != null && r.content != null ? lineDiff(r.prev_content, r.content) : null
          return (
            <div key={r.id} className="card card-flush">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--fs-sm)', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: ev.c, minWidth: '78px' }}>{ev.t}</span>
                <span style={{ fontWeight: 600 }}>{r.prompt_key}</span>
                <span style={{ color: 'var(--text-faint)' }}>{r.version}</span>
                {r.diff_summary && <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--success)', fontWeight: 600 }}>{r.diff_summary}</span>}
                <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)', marginLeft: 'auto' }}>{r.created_at?.slice(0, 16).replace('T', ' ')}</span>
                <button type="button" onClick={() => toggle(r.id)} className="btn-ghost">{isOpen ? '닫기' : '왜·무엇'}</button>
                <button type="button" onClick={() => rollback(r.id)} className="btn-ghost" style={{ color: 'var(--brand)', borderColor: 'var(--brand)' }}>이 버전 롤백</button>
              </div>
              {isOpen && (
                <div style={{ borderTop: 'var(--hairline) solid var(--border-light)', padding: 'var(--space-3) var(--space-4)', backgroundColor: 'var(--surface-bg)' }}>
                  {/* 왜 바꿨나 */}
                  <div style={{ fontSize: 'var(--fs-xs)', marginBottom: 'var(--space-2)' }}>
                    <strong style={{ color: 'var(--text-muted)' }}>왜:</strong> {r.reason || '—'}
                    {r.trigger && <span className="badge" data-status="planned" style={{ marginLeft: 'var(--space-2)' }}>{TRIGGER_LABEL[r.trigger] ?? r.trigger}</span>}
                    <span style={{ marginLeft: 'var(--space-2)', fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>by {r.source === 'ai' ? '🤖 AI' : `👤 ${r.created_by}`}</span>
                  </div>
                  {/* 무엇을 바꿨나 — before→after 라인 diff */}
                  <div style={{ fontSize: 'var(--fs-xs)', marginBottom: 'var(--space-1)' }}>
                    <strong style={{ color: 'var(--text-muted)' }}>무엇:</strong> {r.diff_summary ?? (r.prev_content == null ? '최초 생성(이전본 없음)' : '변경 없음')}
                  </div>
                  {diff && (diff.removed.length > 0 || diff.added.length > 0) && (
                    <pre style={{ ...CODE_BLOCK, marginTop: 'var(--space-1)' }}>
                      {diff.removed.map((l, i) => <div key={`r${i}`} style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}>- {l}</div>)}
                      {diff.added.map((l, i) => <div key={`a${i}`} style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success)' }}>+ {l}</div>)}
                    </pre>
                  )}
                  {/* 최종 본문 전체 보기 */}
                  {r.content && (
                    <details style={{ marginTop: 'var(--space-2)' }}>
                      <summary style={{ fontSize: 'var(--fs-xs)', color: 'var(--info)', cursor: 'pointer' }}>이 버전 전체 본문 보기</summary>
                      <pre style={{ ...CODE_BLOCK, marginTop: 'var(--space-2)' }}>{r.content}</pre>
                    </details>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

function SchemaTab() {
  const { data, isLoading } = useSWR<{ digest: string; tables: string[] }>('/api/admin/ai-prompts?view=schema', fetcher)
  const tables = data?.tables ?? []

  if (isLoading) return <SkelCard lines={5} />
  if (tables.length === 0) {
    return <EmptyState title="AI가 볼 수 있는 테이블이 없어요" description="스키마 다이제스트를 아직 만들지 못했습니다" />
  }

  return (
    <div className="card" style={{ padding: 'var(--space-5)' }}>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '0 0 var(--space-3)' }}>
        AI가 추출 시 인지하는 테이블 {tables.length}개 (public 전체 테이블 자동 포함 — 구조만, 행 데이터는 미포함)
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        {tables.map((t) => <span key={t} className="badge" data-status="planned">{t}</span>)}
      </div>
      <pre style={{ ...CODE_BLOCK, maxHeight: '460px' }}>{data?.digest}</pre>
    </div>
  )
}
