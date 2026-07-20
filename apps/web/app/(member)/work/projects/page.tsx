// 프로젝트 관리 — 업무 허브 5번째 탭. WorkPageShell 골격(탭바→헤더→콘텐츠).
// 목록(검색·정렬·커서 '더 보기') + 생성/수정/삭제(soft) + AI 예상 프로젝트 제안(§5-3 추출형).
// 카드: 이름·기간·상태뱃지·예산·멤버. 검색어/정렬은 URL 동기화(공유·뒤로가기). 상태 3종(로딩/빈/에러).
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import useSWRInfinite from 'swr/infinite'
import { Plus, Pencil, Trash2, FolderOpen, AlertTriangle, X, History } from 'lucide-react'
import WorkPageShell from '@/components/ui/WorkPageShell'
import WorkSubTabs from '@/components/ui/WorkSubTabs'
import { fetcher } from '@/lib/swr-config'
import { useDebounce } from '@/hooks/useDebounce'
import { useEscClose } from '@/lib/use-esc-close'
import { periodLabel, budgetLabel, statusBadge, type ProjectMeta } from '@/lib/work/project-display'
import ProjectFormModal from './ProjectFormModal'
import ProjectAiSuggest from './ProjectAiSuggest'
import WorkOverviewPanel from './WorkOverviewPanel'
import ProjectActivityDrawer from './ProjectActivityDrawer'
import { consumeWorkflowHandoff } from '@/lib/ai-chat/workflow-handoff'

interface Project extends ProjectMeta {
  id: string
  name: string
  created_at: string
  updated_at: string
}
interface Page { items: Project[]; nextCursor: string | null; hasMore: boolean }

type Editing = { mode: 'create' } | { mode: 'edit'; project: Project } | null

// 정렬 옵션(SSOT). value = `${sort}.${dir}`. 기본 = 최신순.
const SORT_OPTIONS = [
  { value: 'created_at.desc', label: '최신순', sort: 'created_at', dir: 'desc' },
  { value: 'name.asc', label: '이름순', sort: 'name', dir: 'asc' },
  { value: 'start_date.desc', label: '시작일순', sort: 'start_date', dir: 'desc' },
  { value: 'year.desc', label: '연도순', sort: 'year', dir: 'desc' },
] as const
const DEFAULT_SORT = SORT_OPTIONS[0].value

export default function ProjectsPage() {
  const router = useRouter()
  const params = useSearchParams()
  const [search, setSearch] = useState(params.get('search') ?? '')
  const debounced = useDebounce(search, 300)
  const initialSort = `${params.get('sort') ?? 'created_at'}.${params.get('dir') ?? 'desc'}`
  const [sort, setSort] = useState(SORT_OPTIONS.some((o) => o.value === initialSort) ? initialSort : DEFAULT_SORT)

  // 뷰 스위치(E: 현황 병합) — 프로젝트 목록 | 현황. URL ?view=overview로 공유·뒤로가기.
  const view: 'projects' | 'overview' = params.get('view') === 'overview' ? 'overview' : 'projects'
  const setView = (next: 'projects' | 'overview') => {
    const sp = new URLSearchParams(Array.from(params.entries()))
    if (next === 'overview') sp.set('view', 'overview'); else sp.delete('view')
    const qs = sp.toString()
    router.replace(qs ? `/work/projects?${qs}` : '/work/projects', { scroll: false })
  }

  // 검색어·정렬 → URL 동기화. 기본값이면 파라미터 제거. (현황 뷰에선 스킵 — view 파라미터 보존)
  useEffect(() => {
    if (view !== 'projects') return
    const sp = new URLSearchParams(Array.from(params.entries()))
    if (debounced) sp.set('search', debounced); else sp.delete('search')
    const opt = SORT_OPTIONS.find((o) => o.value === sort)!
    if (sort !== DEFAULT_SORT) { sp.set('sort', opt.sort); sp.set('dir', opt.dir) }
    else { sp.delete('sort'); sp.delete('dir') }
    const qs = sp.toString()
    router.replace(qs ? `?${qs}` : '/work/projects', { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, sort, view])

  const getKey = useCallback((index: number, prev: Page | null) => {
    if (prev && !prev.nextCursor) return null
    const sp = new URLSearchParams()
    if (debounced) sp.set('search', debounced)
    const opt = SORT_OPTIONS.find((o) => o.value === sort)!
    if (sort !== DEFAULT_SORT) { sp.set('sort', opt.sort); sp.set('dir', opt.dir) }
    if (index > 0 && prev?.nextCursor) sp.set('cursor', prev.nextCursor)
    const qs = sp.toString()
    return `/api/projects${qs ? `?${qs}` : ''}`
  }, [debounced, sort])

  const { data, error, isLoading, size, setSize, mutate, isValidating } = useSWRInfinite<Page>(getKey, fetcher, { revalidateFirstPage: false })

  const projects = data ? data.flatMap((p) => p.items) : []
  const hasMore = data ? Boolean(data[data.length - 1]?.hasMore) : false
  const loadingMore = isValidating && !isLoading && size > 1

  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<Project | null>(null)
  const [activityFor, setActivityFor] = useState<Project | null>(null)
  const [handoffName, setHandoffName] = useState<string | null>(null)

  // §FR-11-3 업무 흐름 연계 — 목록 심층분석에서 "프로젝트로 전달" 시 새 프로젝트 폼을 이름 프리필로 연다.
  // 프로젝트는 자유 서술 본문 필드가 없어 제목만 전달된다(자동 등록 금지 — 저장은 사용자가 직접 확정).
  useEffect(() => {
    if (params.get('handoff') !== '1') return
    const payload = consumeWorkflowHandoff('project')
    if (!payload) return
    setHandoffName(payload.title)
    setEditing({ mode: 'create' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <WorkPageShell
      title="프로젝트 현황"
      description="프로젝트를 관리하고, 고객·딜·프로젝트별 업무 현황을 한눈에 봅니다."
      subTabs={
        <WorkSubTabs
          items={[{ key: 'projects', label: '프로젝트', testId: 'view-projects' }, { key: 'overview', label: '현황', testId: 'view-overview' }]}
          activeKey={view}
          onSelect={(k) => setView(k as 'projects' | 'overview')}
          ariaLabel="프로젝트 현황 뷰 전환"
        />
      }
      actions={
        view === 'projects' ? (
          <button onClick={() => setEditing({ mode: 'create' })} data-testid="new-project"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--brand-fg)', background: 'var(--brand)', border: 'none', borderRadius: 'var(--radius)', padding: 'var(--space-2) var(--space-4)', minHeight: 44, cursor: 'pointer' }}>
            <Plus size={16} /> 프로젝트 추가
          </button>
        ) : undefined
      }
    >
      {view === 'overview' ? (
        <WorkOverviewPanel />
      ) : (
        <>
      <ProjectAiSuggest onConfirmed={() => mutate()} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <input className="input-field" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="프로젝트 이름 검색" aria-label="프로젝트 검색"
          style={{ flex: '1 1 240px', minWidth: 0, maxWidth: 360, minHeight: 44 }} />
        <select className="input-field" value={sort} onChange={(e) => setSort(e.target.value)}
          aria-label="정렬 기준" style={{ flex: '0 0 auto', width: 'auto', minHeight: 44 }}>
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {error ? (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-5)', borderRadius: 'var(--radius-lg)', border: 'var(--border-w-2) solid var(--danger-border)', background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>
          <AlertTriangle size={18} /> 목록을 불러오지 못했습니다 — {error.message}
          <button onClick={() => mutate()} style={{ marginLeft: 'auto', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--danger)', background: 'none', border: 'var(--border-w-2) solid var(--danger-border)', borderRadius: 'var(--radius)', padding: '4px 10px', cursor: 'pointer' }}>다시 시도</button>
        </div>
      ) : isLoading ? (
        <div style={{ color: 'var(--text-faint)', padding: 'var(--space-6)', textAlign: 'center', fontSize: 'var(--fs-sm)' }}>불러오는 중…</div>
      ) : projects.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-8) var(--space-4)', color: 'var(--text-faint)', textAlign: 'center' }}>
          <FolderOpen size={32} strokeWidth={1.5} />
          <p style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text-muted)' }}>
            {debounced ? '검색 결과가 없습니다' : '아직 프로젝트가 없습니다'}
          </p>
          {!debounced && (
            <button onClick={() => setEditing({ mode: 'create' })}
              style={{ marginTop: 'var(--space-1)', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--brand)', background: 'none', border: 'var(--border-w-2) solid var(--brand)', borderRadius: 'var(--radius)', padding: 'var(--space-2) var(--space-4)', cursor: 'pointer' }}>
              첫 프로젝트 만들기
            </button>
          )}
        </div>
      ) : (
        <ul data-testid="project-list" className="responsive-grid-cols-2" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 'var(--space-3)' }}>
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p}
              onEdit={() => setEditing({ mode: 'edit', project: p })}
              onDelete={() => setDeleting(p)}
              onActivity={() => setActivityFor(p)} />
          ))}
        </ul>
      )}

      {hasMore && !error && (
        <div style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>
          <button onClick={() => setSize(size + 1)} disabled={loadingMore}
            style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-muted)', background: 'var(--surface-bg)', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', padding: 'var(--space-2) var(--space-5)', cursor: loadingMore ? 'wait' : 'pointer' }}>
            {loadingMore ? '불러오는 중…' : '더 보기'}
          </button>
        </div>
      )}

      {editing && (
        <ProjectFormModal
          mode={editing.mode}
          projectId={editing.mode === 'edit' ? editing.project.id : undefined}
          initial={
            editing.mode === 'edit'
              ? editing.project
              : handoffName
                ? { name: handoffName }
                : undefined
          }
          onClose={() => { setEditing(null); setHandoffName(null) }}
          onSaved={() => { setEditing(null); setHandoffName(null); mutate() }}
        />
      )}

      {deleting && (
        <DeleteConfirm project={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); mutate() }} />
      )}

      {activityFor && (
        <ProjectActivityDrawer projectId={activityFor.id} projectName={activityFor.name} onClose={() => setActivityFor(null)} onRestored={() => mutate()} />
      )}
        </>
      )}
    </WorkPageShell>
  )
}

// 프로젝트 카드 — 이름 + 기간 + 상태뱃지 + 예산.
function ProjectCard({ project: p, onEdit, onDelete, onActivity }: { project: Project; onEdit: () => void; onDelete: () => void; onActivity: () => void }) {
  const period = periodLabel(p)
  const budget = budgetLabel(p.budget, p.currency)
  const badge = statusBadge(p.status)
  return (
    <li style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', border: 'var(--border-w-2) solid var(--border-color)', background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
        <FolderOpen size={18} style={{ color: 'var(--brand)', flexShrink: 0, marginTop: 2 }} />
        <span style={{ flex: 1, fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text)', wordBreak: 'break-word', lineHeight: 1.3 }}>{p.name}</span>
        <span style={{ flexShrink: 0, fontSize: 'var(--fs-2xs)', fontWeight: 700, color: badge.color, background: badge.bg, border: `var(--hairline) solid ${badge.border}`, borderRadius: '9999px', padding: '2px 10px' }}>{badge.label}</span>
      </div>

      {(period || budget) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1) var(--space-3)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
          {period && <span>{period}</span>}
          {budget && <span style={{ fontWeight: 600, color: 'var(--text)' }}>{budget}</span>}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
        <button onClick={onActivity} aria-label={`${p.name} 이력`} title="저장 이력"
          style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, padding: 'var(--space-2)', borderRadius: 'var(--radius)', background: 'var(--surface-bg)', border: 'var(--hairline) solid var(--border-color)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'var(--fs-2xs)', fontWeight: 600 }}>
          <History size={14} /> 이력
        </button>
        <button onClick={onEdit} aria-label={`${p.name} 수정`}
          style={{ display: 'inline-flex', padding: 'var(--space-2)', borderRadius: 'var(--radius)', background: 'var(--surface-bg)', border: 'var(--hairline) solid var(--border-color)', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <Pencil size={15} />
        </button>
        <button onClick={onDelete} aria-label={`${p.name} 삭제`}
          style={{ display: 'inline-flex', padding: 'var(--space-2)', borderRadius: 'var(--radius)', background: 'var(--danger-bg)', border: 'var(--hairline) solid var(--danger-border)', color: 'var(--danger)', cursor: 'pointer' }}>
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  )
}

function DeleteConfirm({ project, onClose, onDone }: { project: Project; onClose: () => void; onDone: () => void }) {
  useEscClose(onClose)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function confirm() {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        setErr(j?.error ?? '삭제에 실패했습니다'); setBusy(false); return
      }
      onDone()
    } catch {
      setErr('서버 연결에 실패했습니다'); setBusy(false)
    }
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--modal-backdrop)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }}>
      <div style={{ width: '100%', maxWidth: 400, background: 'var(--color-surface)', borderRadius: 'var(--radius)', padding: 'var(--space-6)', boxShadow: 'var(--shadow-modal)', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h3 className="tape-title" style={{ margin: 0 }}>프로젝트 삭제</h3>
          <button onClick={onClose} aria-label="닫기" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}><X size={18} /></button>
        </div>
        <p style={{ margin: '0 0 1rem', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          <b style={{ color: 'var(--text)' }}>{project.name}</b> 프로젝트를 삭제할까요? 연결된 업무는 유지되며 프로젝트 연결만 해제됩니다.
        </p>
        {err && (
          <div role="alert" style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--danger-bg)', border: 'var(--hairline) solid var(--danger-border)', borderRadius: 'var(--radius)', marginBottom: '0.75rem', fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>{err}</div>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>취소</button>
          <button onClick={confirm} disabled={busy} data-testid="confirm-delete"
            style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--nb-white)', background: 'var(--danger)', border: 'none', borderRadius: 'var(--radius)', padding: 'var(--space-2) var(--space-5)', cursor: busy ? 'wait' : 'pointer' }}>
            {busy ? '삭제중' : '삭제'}
          </button>
        </div>
      </div>
    </div>
  )
}
