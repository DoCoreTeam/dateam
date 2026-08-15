'use client'

// 목록 심층분석 — §FR-11-2 "내 분석 문서" 라이브러리 목록.
// 상세 열람/제목편집은 DocumentDetailDrawer로 분리(300줄 제약).
//
// 목록 표준(§2-6): useListQuery(URL이 진실) + ListToolbar + ListSurface + ListPager.
// SessionListClient와 **같은 부품·같은 배치**를 쓴다 — 두 목록이 다르게 동작할 이유가 없다.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, RotateCcw, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import TrashToggle from '@/components/ui/TrashToggle'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef, ListFilterDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import type { ListDefaults } from '@/lib/ui/list-query'
import { useRowSelection } from '@/hooks/useRowSelection'
import { DOC_TYPES, DOC_TYPE_LABEL, type DocType } from '@/lib/ai-chat/grouping/classify-doc'
import {
  listDocuments,
  deleteDocuments,
  restoreDocuments,
  type AnalysisDocumentSummary,
  type DocumentSortKey,
} from './document-actions'
import DocumentDetailDrawer from './DocumentDetailDrawer'
import { ConfirmModal } from './SessionListModals'

const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'updated', dir: 'desc' },
  view: 'table',
  mode: 'more',            // 서버가 커서로 주는 목록 — 총 건수를 모른다
  filterKeys: ['docType', 'deleted'],
}
const SORT_OPTIONS = [
  { key: 'updated', label: '수정일' },
  { key: 'created', label: '생성일' },
]
const FILTERS: ListFilterDef[] = [
  { key: 'docType', label: '유형', options: DOC_TYPES.map((t) => ({ value: t, label: DOC_TYPE_LABEL[t] })) },
]

function docTypeLabel(t: string | null): string {
  if (t && (DOC_TYPES as readonly string[]).includes(t)) return DOC_TYPE_LABEL[t as DocType]
  return '일반 문서'
}

/** 모듈 스코프 — 렌더마다 새 identity가 생겨 선택 훅 메모가 무효화되는 것을 막는다. */
const getDocumentId = (d: AnalysisDocumentSummary) => d.id

export default function DocumentListClient() {
  const router = useRouter()
  const { query, set } = useListQuery(LIST_DEFAULTS, { persistKey: '/ai-chat/analyze/documents' })
  const showDeleted = query.filters.deleted === '1'
  const sortKey: DocumentSortKey = query.sort.key === 'created' ? 'created' : 'updated'

  const [documents, setDocuments] = useState<AnalysisDocumentSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 삭제/되돌리기 확인 대상 — 1건(행 버튼)과 N건(선택 일괄)을 같은 배열로 다룬다. */
  const [pending, setPending] = useState<AnalysisDocumentSummary[] | null>(null)
  const [pendingError, setPendingError] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  const selection = useRowSelection(documents, getDocumentId)

  const load = useCallback(
    async (cursor?: string) => {
      cursor ? setLoadingMore(true) : setLoading(true)
      setError(null)
      const r = await listDocuments({
        q: query.q || undefined,
        sort: sortKey,
        filter: { docType: query.filters.docType || undefined, deleted: showDeleted },
        cursor,
        limit: 30,
      })
      if (!r.ok) {
        setError(r.error)
        cursor ? setLoadingMore(false) : setLoading(false)
        return
      }
      setDocuments((prev) => (cursor ? [...prev, ...r.documents] : r.documents))
      setNextCursor(r.nextCursor)
      cursor ? setLoadingMore(false) : setLoading(false)
    },
    [query.q, sortKey, query.filters.docType, showDeleted],
  )

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.q, sortKey, query.filters.docType, showDeleted])

  /** 1건·N건 공용 확정 처리 — 서버가 실제 반영한 id(affectedIds)만 목록·선택에서 뺀다(부분 성공 정합). */
  async function handleConfirmed() {
    if (!pending || pending.length === 0) return
    const ids = pending.map((d) => d.id)
    const r = showDeleted ? await restoreDocuments(ids) : await deleteDocuments(ids)
    if (!r.ok) {
      setPendingError(r.error)
      return
    }
    const done = new Set(r.affectedIds)
    setDocuments((prev) => prev.filter((d) => !done.has(d.id)))
    selection.remove(r.affectedIds)
    setPending(null)
    setPendingError(null)
  }

  function openBulkConfirm() {
    const targets = documents.filter((d) => selection.isSelected(d.id))
    if (targets.length === 0) return
    setPendingError(null)
    setPending(targets)
  }

  function openSingleConfirm(d: AnalysisDocumentSummary) {
    setPendingError(null)
    setPending([d])
  }

  const columns: ColumnDef<AnalysisDocumentSummary>[] = [
    {
      key: 'title', header: '제목', primary: true,
      cell: (d) => <span style={{ fontWeight: 700, color: 'var(--text)' }}>{d.title}</span>,
    },
    {
      key: 'docType', header: '문서유형',
      cell: (d) => <span className="badge" data-status="planned">{docTypeLabel(d.docType)}</span>,
    },
    {
      key: 'updated', header: '수정일', sortable: 'updated',
      cell: (d) => <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{new Date(d.updatedAt).toLocaleString('ko-KR')}</span>,
    },
    {
      key: 'session', header: '원본 세션', hideOnCard: true,
      cell: (d) =>
        d.sessionId ? (
          <NbButton variant="ghost" onClick={(e) => { e.stopPropagation(); router.push('/ai-chat/analyze?tab=list') }}>
            세션 보기
          </NbButton>
        ) : (
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>—</span>
        ),
    },
    {
      key: 'actions', header: '', noLabel: true, align: 'right',
      cell: (d) => (
        <div className="card-actions" style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <NbButton variant={showDeleted ? 'ghost' : 'danger-ghost'}
            onClick={(e) => { e.stopPropagation(); openSingleConfirm(d) }}
            aria-label={showDeleted ? `${d.title} 되돌리기` : `${d.title} 삭제`}
            title={showDeleted ? '되돌리기' : '삭제'}>
            {showDeleted ? <RotateCcw size={15} /> : <Trash2 size={14} />}
          </NbButton>
        </div>
      ),
    },
  ]

  return (
    <div>
      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="제목·본문 검색"
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
            <NbButton variant="danger" onClick={openBulkConfirm} data-testid="bulk-delete-documents">
              <Trash2 size={15} /> 선택 삭제
            </NbButton>
          ),
        }}
        actions={
          <TrashToggle
            value={showDeleted}
            onChange={(v) => set({ filters: { deleted: v ? '1' : '' } })}
            activeLabel="문서 목록"
          />
        }
      />

      <ListSurface
        rows={documents}
        columns={columns}
        query={query}
        rowKey={getDocumentId}
        onChange={set}
        loading={loading}
        error={error ? { message: `문서 목록을 불러오지 못했습니다 — ${error}`, onRetry: () => load() } : null}
        empty={{
          title: showDeleted
            ? '삭제된 문서가 없어요'
            : query.q || query.filters.docType
              ? '조건에 맞는 문서가 없어요'
              : '아직 저장된 분석 문서가 없어요',
          description: showDeleted ? undefined : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <FileText size={14} /> 분석을 마치고 “문서함에 저장”을 누르면 여기 쌓입니다
            </span>
          ),
        }}
        onRowClick={showDeleted ? undefined : (d) => setDetailId(d.id)}
        selection={{
          selected: new Set(selection.selectedIds),
          onToggle: selection.toggle,
          onToggleAll: selection.toggleAll,
          allSelected: selection.allSelected,
          someSelected: selection.someSelected,
          rowLabel: (d) => `${d.title} 선택`,
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

      {pending && pending.length > 0 && (
        <ConfirmModal
          title={showDeleted ? '문서 되돌리기' : '문서 삭제'}
          message={
            <>
              {pending.length === 1 ? (
                <>‘<b style={{ color: 'var(--text)' }}>{pending[0].title}</b>’ 문서를</>
              ) : (
                <>선택한 <b style={{ color: 'var(--text)' }}>{pending.length}개</b> 문서를</>
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

      {detailId && (
        <DocumentDetailDrawer
          documentId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={(patch) => setDocuments((prev) => prev.map((d) => (d.id === detailId ? { ...d, ...patch } : d)))}
          onDeleted={() => { setDocuments((prev) => prev.filter((d) => d.id !== detailId)); setDetailId(null) }}
        />
      )}
    </div>
  )
}
