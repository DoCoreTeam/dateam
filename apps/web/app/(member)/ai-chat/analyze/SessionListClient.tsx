'use client'

// 목록 심층분석 — 세션 목록(§C4). 검색·정렬·필터·서버 커서 페이지네이션 + CRUD(이름변경/소프트삭제/되돌리기).
// AnalyzeClient(새 분석)와 별개 탭 — 새 분석 착수는 그 화면에서, 여기는 지난 세션 관리 전용.
// 상태(q/sort/phase/synth/deleted/cursor)는 URL 동기화(tab=list 보존, 공유·뒤로가기 가능).

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, History, Inbox, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbTable, { type NbColumn } from '@/components/ui/nb/NbTable'
import { useDebounce } from '@/hooks/useDebounce'
import {
  listAnalysisSessions,
  deleteAnalysisSession,
  restoreAnalysisSession,
  type AnalysisSessionSummary,
  type SessionSortKey,
} from './session-list-actions'
import { RenameModal, ConfirmModal, SessionDetailDrawer } from './SessionListModals'

const SORT_OPTIONS: { value: SessionSortKey; label: string }[] = [
  { value: 'updated', label: '최근 수정순' },
  { value: 'created', label: '최근 생성순' },
]

const PHASE_LABEL: Record<string, string> = {
  idle: '대기', analyzing: '분석중', synthesizing: '종합중', done: '완료',
}
const SYNTH_LABEL: Record<string, string> = {
  pending: '종합 대기', running: '종합중', done: '종합완료', error: '종합 실패',
}
const PHASE_OPTIONS = ['idle', 'analyzing', 'synthesizing', 'done']
const SYNTH_OPTIONS = ['pending', 'running', 'done', 'error']

function phaseColor(phase: string): string {
  if (phase === 'done') return 'var(--success)'
  if (phase === 'idle') return 'var(--text-faint)'
  return 'var(--info)'
}

export default function SessionListClient() {
  const router = useRouter()
  const sp = useSearchParams()

  const [search, setSearch] = useState(sp.get('q') ?? '')
  const debouncedSearch = useDebounce(search, 300)
  const [sort, setSort] = useState<SessionSortKey>(sp.get('sort') === 'created' ? 'created' : 'updated')
  const [phase, setPhase] = useState(sp.get('phase') ?? '')
  const [synth, setSynth] = useState(sp.get('synth') ?? '')
  const [showDeleted, setShowDeleted] = useState(sp.get('deleted') === '1')

  const [sessions, setSessions] = useState<AnalysisSessionSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [renaming, setRenaming] = useState<AnalysisSessionSummary | null>(null)
  const [deleting, setDeleting] = useState<AnalysisSessionSummary | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  // URL 동기화 — tab=list 보존, 기본값이면 파라미터 제거
  useEffect(() => {
    const next = new URLSearchParams(Array.from(sp.entries()))
    next.set('tab', 'list')
    if (debouncedSearch) next.set('q', debouncedSearch); else next.delete('q')
    if (sort !== 'updated') next.set('sort', sort); else next.delete('sort')
    if (phase) next.set('phase', phase); else next.delete('phase')
    if (synth) next.set('synth', synth); else next.delete('synth')
    if (showDeleted) next.set('deleted', '1'); else next.delete('deleted')
    next.delete('cursor')
    router.replace(`?${next.toString()}`, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, sort, phase, synth, showDeleted])

  const load = useCallback(
    async (cursor?: string) => {
      cursor ? setLoadingMore(true) : setLoading(true)
      setError(null)
      const r = await listAnalysisSessions({
        q: debouncedSearch || undefined,
        sort,
        filter: { phase: phase || undefined, synthStatus: synth || undefined, deleted: showDeleted },
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
    [debouncedSearch, sort, phase, synth, showDeleted],
  )

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, sort, phase, synth, showDeleted])

  async function handleDeleteConfirmed() {
    if (!deleting) return
    const r = showDeleted ? await restoreAnalysisSession(deleting.id) : await deleteAnalysisSession(deleting.id)
    if (r.ok) {
      setSessions((prev) => prev.filter((s) => s.id !== deleting.id))
      setDeleting(null)
    }
  }

  const columns: NbColumn<AnalysisSessionSummary>[] = [
    {
      key: 'title', header: '제목', cardHeader: true,
      render: (s) => <span style={{ fontWeight: 700, color: 'var(--text)' }}>{s.title}</span>,
    },
    {
      key: 'progress', header: '진행', label: '진행',
      render: (s) => <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{s.doneCount}/{s.itemCount}개</span>,
    },
    {
      key: 'phase', header: '상태', label: '상태',
      render: (s) => (
        <span style={{ display: 'inline-flex', gap: 'var(--space-1)', alignItems: 'center', fontSize: 'var(--fs-2xs)', fontWeight: 700, color: phaseColor(s.phase) }}>
          {PHASE_LABEL[s.phase] ?? s.phase}
          {s.synthStatus !== 'pending' && (
            <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>· {SYNTH_LABEL[s.synthStatus] ?? s.synthStatus}</span>
          )}
        </span>
      ),
    },
    {
      key: 'updated', header: '수정일', hideOnMobile: true,
      render: (s) => <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{new Date(s.updatedAt).toLocaleString('ko-KR')}</span>,
    },
    {
      key: 'actions', header: '', label: '',
      render: (s) => (
        <div className="card-actions" style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          {showDeleted ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); setDeleting(s) }} aria-label={`${s.title} 되돌리기`} title="되돌리기"
              style={{ minHeight: 44, minWidth: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-bg)', border: 'var(--hairline) solid var(--border-color)', borderRadius: 'var(--radius)', color: 'var(--info)', cursor: 'pointer' }}>
              <RotateCcw size={15} />
            </button>
          ) : (
            <>
              <button type="button" onClick={(e) => { e.stopPropagation(); setRenaming(s) }} aria-label={`${s.title} 이름변경`} title="이름변경"
                style={{ minHeight: 44, minWidth: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-bg)', border: 'var(--hairline) solid var(--border-color)', borderRadius: 'var(--radius)', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <Pencil size={14} />
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); setDeleting(s) }} aria-label={`${s.title} 삭제`} title="삭제"
                style={{ minHeight: 44, minWidth: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--danger-bg)', border: 'var(--hairline) solid var(--danger-border)', borderRadius: 'var(--radius)', color: 'var(--danger)', cursor: 'pointer' }}>
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <input className="input-field" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="제목·원문 검색" aria-label="세션 검색"
          style={{ flex: '1 1 220px', minWidth: 0, maxWidth: 320, minHeight: 44 }} />
        <select className="input-field" value={sort} onChange={(e) => setSort(e.target.value as SessionSortKey)}
          aria-label="정렬 기준" style={{ flex: '0 0 auto', width: 'auto', minHeight: 44 }}>
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="input-field" value={phase} onChange={(e) => setPhase(e.target.value)}
          aria-label="상태 필터" style={{ flex: '0 0 auto', width: 'auto', minHeight: 44 }}>
          <option value="">전체 상태</option>
          {PHASE_OPTIONS.map((p) => <option key={p} value={p}>{PHASE_LABEL[p]}</option>)}
        </select>
        <select className="input-field" value={synth} onChange={(e) => setSynth(e.target.value)}
          aria-label="종합 상태 필터" style={{ flex: '0 0 auto', width: 'auto', minHeight: 44 }}>
          <option value="">종합 전체</option>
          {SYNTH_OPTIONS.map((s) => <option key={s} value={s}>{SYNTH_LABEL[s]}</option>)}
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', minHeight: 44 }}>
          <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
          휴지통
        </label>
      </div>

      {error ? (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-5)', borderRadius: 'var(--radius-lg)', border: 'var(--border-w-2) solid var(--danger-border)', background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>
          <AlertTriangle size={18} /> 목록을 불러오지 못했습니다 — {error}
          <button onClick={() => load()} style={{ marginLeft: 'auto', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--danger)', background: 'none', border: 'var(--border-w-2) solid var(--danger-border)', borderRadius: 'var(--radius)', padding: '4px 10px', cursor: 'pointer' }}>다시 시도</button>
        </div>
      ) : loading ? (
        <div style={{ color: 'var(--text-faint)', padding: 'var(--space-6)', textAlign: 'center', fontSize: 'var(--fs-sm)' }}>불러오는 중…</div>
      ) : sessions.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-8) var(--space-4)', color: 'var(--text-faint)', textAlign: 'center' }}>
          {showDeleted ? <History size={32} strokeWidth={1.5} /> : <Inbox size={32} strokeWidth={1.5} />}
          <p style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text-muted)' }}>
            {showDeleted ? '삭제된 세션이 없습니다' : debouncedSearch || phase || synth ? '검색 결과가 없습니다' : '아직 분석 세션이 없습니다'}
          </p>
        </div>
      ) : (
        <NbTable
          columns={columns}
          rows={sessions}
          getRowKey={(s) => s.id}
          onRowClick={showDeleted ? undefined : (s) => setDetailId(s.id)}
        />
      )}

      {nextCursor && !error && (
        <div style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>
          <NbButton variant="secondary" onClick={() => load(nextCursor)} disabled={loadingMore}>
            {loadingMore ? '불러오는 중…' : '더 보기'}
          </NbButton>
        </div>
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

      {deleting && (
        <ConfirmModal
          title={showDeleted ? '세션 되돌리기' : '세션 삭제'}
          message={
            showDeleted
              ? <>‘<b style={{ color: 'var(--text)' }}>{deleting.title}</b>’ 세션을 되돌릴까요? 목록에 다시 표시됩니다.</>
              : <>‘<b style={{ color: 'var(--text)' }}>{deleting.title}</b>’ 세션을 삭제할까요? 나중에 휴지통에서 되돌릴 수 있습니다.</>
          }
          confirmLabel={showDeleted ? '되돌리기' : '삭제'}
          danger={!showDeleted}
          onClose={() => setDeleting(null)}
          onConfirm={handleDeleteConfirmed}
        />
      )}

      {detailId && <SessionDetailDrawer sessionId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  )
}
