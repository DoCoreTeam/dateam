'use client'

// 목록 심층분석 — 세션 목록(§C4). 검색·정렬·필터·서버 커서 페이지네이션 + CRUD(이름변경/소프트삭제/되돌리기).
// AnalyzeClient(새 분석)와 별개 탭 — 새 분석 착수는 그 화면에서, 여기는 지난 세션 관리 전용.
//
// 목록 표준(§2-6)을 쓴다: useListQuery(URL이 진실) + ListToolbar + ListSurface + ListPager.
// 예전엔 이 화면만을 위한 부품 한 벌(NbTable·BulkActionBar)과 자작 필터바·오류·로딩·빈상태를
// 따로 갖고 있었다. 같은 일을 하는 부품이 두 벌이면 화면마다 다르게 동작하고, 고칠 때 한쪽만 고쳐진다.

import { useCallback, useEffect, useState } from 'react'
import { Pencil, RotateCcw, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import TrashToggle from '@/components/ui/TrashToggle'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef, ListFilterDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import type { ListDefaults } from '@/lib/ui/list-query'
import { useRowSelection } from '@/hooks/useRowSelection'
import {
  listAnalysisSessions,
  deleteAnalysisSessions,
  restoreAnalysisSessions,
  type AnalysisSessionSummary,
  type SessionSortKey,
} from './session-list-actions'
import { RenameModal, ConfirmModal, SessionDetailDrawer } from './SessionListModals'

const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'updated', dir: 'desc' },
  view: 'table',
  mode: 'more',            // 서버가 커서로 주는 목록 — 총 건수를 모른다
  filterKeys: ['phase', 'synth', 'deleted'],
}
const SORT_OPTIONS = [
  { key: 'updated', label: '수정일' },
  { key: 'created', label: '생성일' },
]

const PHASE_LABEL: Record<string, string> = {
  idle: '대기', analyzing: '분석중', synthesizing: '종합중', done: '완료',
}
const SYNTH_LABEL: Record<string, string> = {
  pending: '종합 대기', running: '종합중', done: '종합완료', error: '종합 실패',
}
const FILTERS: ListFilterDef[] = [
  { key: 'phase', label: '상태', options: ['idle', 'analyzing', 'synthesizing', 'done'].map((v) => ({ value: v, label: PHASE_LABEL[v] })) },
  { key: 'synth', label: '종합', options: ['pending', 'running', 'done', 'error'].map((v) => ({ value: v, label: SYNTH_LABEL[v] })) },
]

/**
 * 상태 라벨/색 — control(사용자 제어)이 phase(서버 진행)보다 우선한다.
 * 취소/일시정지된 세션이 phase='analyzing'으로 남아 "분석중"으로 영원히 표시되던 버그 해소.
 */
function statusLabel(phase: string, control: string): string {
  if (control === 'cancelled') return '중단됨'
  if (control === 'paused') return '일시정지'
  return PHASE_LABEL[phase] ?? phase
}
function statusColor(phase: string, control: string): string {
  if (control === 'cancelled') return 'var(--text-faint)'
  if (control === 'paused') return 'var(--warning)'
  if (phase === 'done') return 'var(--success)'
  if (phase === 'idle') return 'var(--text-faint)'
  return 'var(--info)'
}

/** 모듈 스코프 — 렌더마다 새 함수 identity가 생겨 선택 훅 메모가 무효화되는 것을 막는다. */
const getSessionId = (s: AnalysisSessionSummary) => s.id

export default function SessionListClient() {
  const { query, set } = useListQuery(LIST_DEFAULTS, { persistKey: '/ai-chat/analyze/list' })
  const showDeleted = query.filters.deleted === '1'
  const sortKey: SessionSortKey = query.sort.key === 'created' ? 'created' : 'updated'

  const [sessions, setSessions] = useState<AnalysisSessionSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [renaming, setRenaming] = useState<AnalysisSessionSummary | null>(null)
  /** 삭제/되돌리기 확인 대상 — 1건(행 버튼)과 N건(선택 일괄)을 같은 배열로 다룬다. */
  const [pending, setPending] = useState<AnalysisSessionSummary[] | null>(null)
  const [pendingError, setPendingError] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  const selection = useRowSelection(sessions, getSessionId)

  const load = useCallback(
    async (cursor?: string) => {
      cursor ? setLoadingMore(true) : setLoading(true)
      setError(null)
      const r = await listAnalysisSessions({
        q: query.q || undefined,
        sort: sortKey,
        filter: {
          phase: query.filters.phase || undefined,
          synthStatus: query.filters.synth || undefined,
          deleted: showDeleted,
        },
        cursor,
        limit: 30,
      })
      if (!r.ok) {
        setError(r.error)
        cursor ? setLoadingMore(false) : setLoading(false)
        return
      }
      setSessions((prev) => (cursor ? [...prev, ...r.sessions] : r.sessions))
      setNextCursor(r.nextCursor)
      cursor ? setLoadingMore(false) : setLoading(false)
    },
    [query.q, sortKey, query.filters.phase, query.filters.synth, showDeleted],
  )

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.q, sortKey, query.filters.phase, query.filters.synth, showDeleted])

  /** 1건·N건 공용 확정 처리 — 서버가 실제 반영한 id(affectedIds)만 목록·선택에서 뺀다(부분 성공 정합). */
  async function handleConfirmed() {
    if (!pending || pending.length === 0) return
    const ids = pending.map((s) => s.id)
    const r = showDeleted ? await restoreAnalysisSessions(ids) : await deleteAnalysisSessions(ids)
    if (!r.ok) {
      setPendingError(r.error)
      return
    }
    const done = new Set(r.affectedIds)
    setSessions((prev) => prev.filter((s) => !done.has(s.id)))
    selection.remove(r.affectedIds)
    setPending(null)
    setPendingError(null)
  }

  function openBulkConfirm() {
    const targets = sessions.filter((s) => selection.isSelected(s.id))
    if (targets.length === 0) return
    setPendingError(null)
    setPending(targets)
  }

  function openSingleConfirm(s: AnalysisSessionSummary) {
    setPendingError(null)
    setPending([s])
  }

  const columns: ColumnDef<AnalysisSessionSummary>[] = [
    {
      key: 'title', header: '제목', primary: true, sortable: false,
      cell: (s) => <span style={{ fontWeight: 700, color: 'var(--text)' }}>{s.title}</span>,
    },
    {
      key: 'progress', header: '진행',
      cell: (s) => <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{s.doneCount}/{s.itemCount}개</span>,
    },
    {
      key: 'phase', header: '상태',
      cell: (s) => (
        <span style={{ display: 'inline-flex', gap: 'var(--space-1)', alignItems: 'center', fontSize: 'var(--fs-2xs)', fontWeight: 700, color: statusColor(s.phase, s.control) }}>
          {statusLabel(s.phase, s.control)}
          {s.synthStatus !== 'pending' && (
            <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>· {SYNTH_LABEL[s.synthStatus] ?? s.synthStatus}</span>
          )}
        </span>
      ),
    },
    {
      key: 'updated', header: '수정일', hideOnCard: true, sortable: 'updated',
      cell: (s) => <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{new Date(s.updatedAt).toLocaleString('ko-KR')}</span>,
    },
    {
      key: 'actions', header: '', noLabel: true, align: 'right',
      cell: (s) => (
        <div className="card-actions" style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          {showDeleted ? (
            <NbButton variant="ghost" onClick={(e) => { e.stopPropagation(); openSingleConfirm(s) }} aria-label={`${s.title} 되돌리기`} title="되돌리기">
              <RotateCcw size={15} />
            </NbButton>
          ) : (
            <>
              <NbButton variant="ghost" onClick={(e) => { e.stopPropagation(); setRenaming(s) }} aria-label={`${s.title} 이름변경`} title="이름변경">
                <Pencil size={14} />
              </NbButton>
              <NbButton variant="danger-ghost" onClick={(e) => { e.stopPropagation(); openSingleConfirm(s) }} aria-label={`${s.title} 삭제`} title="삭제">
                <Trash2 size={14} />
              </NbButton>
            </>
          )}
        </div>
      ),
    },
  ]

  return (
    <div>
      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="제목·원문 검색"
        filters={FILTERS}
        sortOptions={SORT_OPTIONS}
        showSize={false}
        views={['table', 'card']}
        selection={{
          count: selection.count,
          onClear: selection.clear,
          actions: showDeleted ? (
            <NbButton variant="secondary" onClick={openBulkConfirm}>
              <RotateCcw size={15} /> 선택 되돌리기
            </NbButton>
          ) : (
            <NbButton variant="danger" onClick={openBulkConfirm} data-testid="bulk-delete-sessions">
              <Trash2 size={15} /> 선택 삭제
            </NbButton>
          ),
        }}
        actions={
          <TrashToggle
            value={showDeleted}
            onChange={(v) => set({ filters: { deleted: v ? '1' : '' } })}
            activeLabel="원문 목록"
          />
        }
      />

      <ListSurface
        rows={sessions}
        columns={columns}
        query={query}
        rowKey={getSessionId}
        onChange={set}
        loading={loading}
        error={error ? { message: `목록을 불러오지 못했습니다 — ${error}`, onRetry: () => load() } : null}
        empty={{
          title: showDeleted
            ? '삭제된 세션이 없어요'
            : query.q || query.filters.phase || query.filters.synth
              ? '조건에 맞는 세션이 없어요'
              : '아직 분석 세션이 없어요',
          description: showDeleted ? undefined : '‘새 분석’ 탭에서 자료를 넣으면 여기에 쌓입니다',
        }}
        onRowClick={showDeleted ? undefined : (s) => setDetailId(s.id)}
        selection={{
          selected: new Set(selection.selectedIds),
          onToggle: selection.toggle,
          onToggleAll: selection.toggleAll,
          allSelected: selection.allSelected,
          someSelected: selection.someSelected,
          rowLabel: (s) => `${s.title} 선택`,
        }}
      />

      {!error && (
        <ListPager
          query={query}
          hasMore={!!nextCursor}
          loading={loadingMore}
          // 커서 목록이라 페이지 번호가 주소에 남을 이유가 없다 — 다음 커서를 이어 붙인다.
          onChange={() => { if (nextCursor) load(nextCursor) }}
        />
      )}

      {renaming && (
        <RenameModal
          session={renaming}
          onClose={() => setRenaming(null)}
          onRenamed={(title) => {
            setSessions((prev) => prev.map((s) => (s.id === renaming.id ? { ...s, title } : s)))
            setRenaming(null)
          }}
        />
      )}

      {pending && pending.length > 0 && (
        <ConfirmModal
          title={showDeleted ? '세션 되돌리기' : '세션 삭제'}
          message={
            <>
              {pending.length === 1 ? (
                <>‘<b style={{ color: 'var(--text)' }}>{pending[0].title}</b>’ 세션을</>
              ) : (
                <>선택한 <b style={{ color: 'var(--text)' }}>{pending.length}개</b> 세션을</>
              )}
              {showDeleted ? ' 되돌릴까요? 목록에 다시 표시됩니다.' : ' 삭제할까요? 나중에 휴지통에서 되돌릴 수 있습니다.'}
            </>
          }
          confirmLabel={showDeleted ? '되돌리기' : '삭제'}
          danger={!showDeleted}
          error={pendingError}
          onClose={() => { setPending(null); setPendingError(null) }}
          onConfirm={handleConfirmed}
        />
      )}

      {detailId && <SessionDetailDrawer sessionId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  )
}
