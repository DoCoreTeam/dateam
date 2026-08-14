// 프로젝트 관리 — 업무 허브 5번째 탭. WorkPageShell 골격(탭바→헤더→콘텐츠).
// 목록은 표준(§2-6) — 검색·정렬·페이지는 URL이 진실(useListQuery) + ListToolbar/ListSurface/ListPager.
// 생성/수정/삭제(soft) + AI 예상 프로젝트 제안(§5-3 추출형)은 그대로.
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import useSWRInfinite from 'swr/infinite'
import { Plus, Pencil, Trash2, FolderOpen, X, History } from 'lucide-react'
import WorkPageShell from '@/components/ui/WorkPageShell'
import WorkSubTabs from '@/components/ui/WorkSubTabs'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import type { ListDefaults } from '@/lib/ui/list-query'
import { fetcher } from '@/lib/swr-config'
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

// 커서 API라 페이지 크기는 서버가 정한다 → 목록 도구에서 개수 선택을 숨긴다.
// 보기 전환은 두지 않는다 — `?view=overview`(현황 뷰)와 파라미터가 겹친다.
const LIST_DEFAULTS: ListDefaults = { sort: { key: 'created_at', dir: 'desc' }, mode: 'more', view: 'card' }
const SORT_OPTIONS = [
  { key: 'created_at', label: '등록일' },
  { key: 'name', label: '이름' },
  { key: 'start_date', label: '시작일' },
  { key: 'year', label: '연도' },
]

export default function ProjectsPage() {
  const router = useRouter()
  const params = useSearchParams()
  const { query, set } = useListQuery(LIST_DEFAULTS, { persistKey: '/work/projects' })

  // 화면 전환(프로젝트 목록 | 현황)은 `?panel=`이다.
  // 예전엔 `?view=overview`였는데, 목록 표준(§2-6)이 `view`를 표/카드/조밀 전환에
  // **예약**하고 있어 충돌했다. 그래서 목록 보기전환을 `views={['card']}`로 막아 둔
  // 상태였고, 사용자는 프로젝트를 표로 볼 수 없었다. 화면 고유 상태가 자리를 비켜준다.
  // 구 링크(?view=overview)는 계속 받는다.
  const panel: 'projects' | 'overview' =
    params.get('panel') === 'overview' || params.get('view') === 'overview' ? 'overview' : 'projects'
  const setPanel = (next: 'projects' | 'overview') => {
    const sp = new URLSearchParams(Array.from(params.entries()))
    sp.delete('view') // 구 파라미터 정리 — 남아 있으면 목록 보기전환과 다시 엉킨다
    if (next === 'overview') sp.set('panel', 'overview'); else sp.delete('panel')
    const qs = sp.toString()
    router.replace(qs ? `/work/projects?${qs}` : '/work/projects', { scroll: false })
  }

  const getKey = useCallback((index: number, prev: Page | null) => {
    if (prev && !prev.nextCursor) return null
    const sp = new URLSearchParams()
    if (query.q) sp.set('search', query.q)
    if (query.sort.key !== 'created_at') sp.set('sort', query.sort.key)
    if (query.sort.dir !== 'desc') sp.set('dir', query.sort.dir)
    if (index > 0 && prev?.nextCursor) sp.set('cursor', prev.nextCursor)
    const qs = sp.toString()
    return `/api/projects${qs ? `?${qs}` : ''}`
  }, [query.q, query.sort.key, query.sort.dir])

  const { data, error, isLoading, size, setSize, mutate, isValidating } = useSWRInfinite<Page>(getKey, fetcher, { revalidateFirstPage: false })

  // '더 보기'는 URL(page)이 진실이다 — 새로고침해도 보던 만큼 다시 불러온다
  useEffect(() => { if (size !== query.page) setSize(query.page) }, [query.page, size, setSize])

  const projects = data ? data.flatMap((p) => p.items) : []
  const hasMore = data ? Boolean(data[data.length - 1]?.hasMore) : false

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

  const columns = useMemo<ColumnDef<Project>[]>(() => [
    {
      key: 'name', header: '프로젝트', primary: true, sortable: 'name',
      cell: (p) => {
        const badge = statusBadge(p.status)
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <FolderOpen size={16} style={{ color: 'var(--brand)', flexShrink: 0 }} aria-hidden />
            <span style={{ fontWeight: 700, color: 'var(--text)', wordBreak: 'break-word' }}>{p.name}</span>
            <span style={{ flexShrink: 0, fontSize: 'var(--fs-2xs)', fontWeight: 700, color: badge.color, background: badge.bg, border: `var(--hairline) solid ${badge.border}`, borderRadius: '9999px', padding: '2px 10px' }}>{badge.label}</span>
          </span>
        )
      },
    },
    { key: 'period', header: '기간', sortable: 'start_date', cell: (p) => periodLabel(p) ?? '—' },
    {
      key: 'budget', header: '예산',
      cell: (p) => budgetLabel(p.budget, p.currency) ?? '—',
    },
    {
      key: 'actions', header: '작업', align: 'right',
      cell: (p) => (
        <span className="project-card-actions" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}
          onClick={(e) => e.stopPropagation()}>
          <Link href={`/work/projects/${p.id}`} className="btn-ghost"
            style={{ textDecoration: 'none', padding: 'var(--space-1) var(--space-3)', fontSize: 'var(--fs-xs)' }}>상세</Link>
          <button type="button" className="btn-ghost" onClick={() => setActivityFor(p)} aria-label={`${p.name} 이력`} title="저장 이력"
            style={{ padding: 'var(--space-1) var(--space-2)' }}><History size={14} /></button>
          <button type="button" className="btn-ghost" onClick={() => setEditing({ mode: 'edit', project: p })} aria-label={`${p.name} 수정`}
            style={{ padding: 'var(--space-1) var(--space-2)' }}><Pencil size={15} /></button>
          <button type="button" className="btn-ghost" onClick={() => setDeleting(p)} aria-label={`${p.name} 삭제`}
            style={{ padding: 'var(--space-1) var(--space-2)', color: 'var(--danger)' }}><Trash2 size={15} /></button>
        </span>
      ),
    },
  ], [])

  return (
    <WorkPageShell
      title="프로젝트 현황"
      description="프로젝트를 관리하고, 고객·딜·프로젝트별 업무 현황을 한눈에 봅니다."
      subTabs={
        <WorkSubTabs
          items={[{ key: 'projects', label: '프로젝트', testId: 'view-projects' }, { key: 'overview', label: '현황', testId: 'view-overview' }]}
          activeKey={panel}
          onSelect={(k) => setPanel(k as 'projects' | 'overview')}
          ariaLabel="프로젝트 현황 뷰 전환"
        />
      }
      actions={
        panel === 'projects' ? (
          <button type="button" className="btn-primary" onClick={() => setEditing({ mode: 'create' })} data-testid="new-project"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', minHeight: 44 }}>
            <Plus size={16} /> 프로젝트 추가
          </button>
        ) : undefined
      }
    >
      {panel === 'overview' ? (
        <WorkOverviewPanel />
      ) : (
        <>
          <ProjectAiSuggest onConfirmed={() => mutate()} />

          <ListToolbar
            query={query}
            onChange={set}
            searchPlaceholder="프로젝트 이름 검색"
            sortOptions={SORT_OPTIONS}
            views={['table', 'card']}
            showSize={false}
            total={isLoading ? undefined : projects.length}
          />

          <div data-testid="project-list">
            <ListSurface
              rows={projects}
              columns={columns}
              query={query}
              rowKey={(p) => p.id}
              onChange={set}
              loading={isLoading}
              error={error ? { message: `목록을 불러오지 못했습니다 — ${error.message ?? ''}`, onRetry: () => { void mutate() } } : null}
              empty={query.q
                ? { title: '조건에 맞는 프로젝트가 없어요', description: '검색어를 바꿔보세요' }
                : { title: '아직 프로젝트가 없어요', description: '업무를 묶어 관리할 프로젝트를 먼저 만들어 주세요', action: { label: '첫 프로젝트 만들기', onClick: () => setEditing({ mode: 'create' }) } }}
            />
          </div>

          <ListPager query={query} hasMore={hasMore} onChange={set} loading={isValidating && !isLoading} />

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
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-card" style={{ width: '100%', maxWidth: 400, padding: 'var(--space-6)', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h3 className="tape-title" style={{ margin: 0 }}>프로젝트 삭제</h3>
          <button type="button" onClick={onClose} aria-label="닫기" className="btn-ghost" style={{ padding: 'var(--space-1)' }}><X size={18} /></button>
        </div>
        <p style={{ margin: '0 0 1rem', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          <b style={{ color: 'var(--text)' }}>{project.name}</b> 프로젝트를 삭제할까요? 연결된 업무는 유지되며 프로젝트 연결만 해제됩니다.
        </p>
        {err && (
          <div role="alert" style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--danger-bg)', border: 'var(--hairline) solid var(--danger-border)', borderRadius: 'var(--radius)', marginBottom: '0.75rem', fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>{err}</div>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <button type="button" className="btn-ghost" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary" onClick={confirm} disabled={busy} data-testid="confirm-delete"
            style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}>
            {busy ? '삭제중' : '삭제'}
          </button>
        </div>
      </div>
    </div>
  )
}
