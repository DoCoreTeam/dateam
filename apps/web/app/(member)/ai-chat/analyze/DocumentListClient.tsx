'use client'

// 목록 심층분석 — §FR-11-2 "내 분석 문서" 라이브러리 목록. session-list-actions.ts와 동일 컨벤션:
// 검색·정렬·필터·서버 커서 페이지네이션 + URL 동기화(tab=documents 보존) + CRUD(소프트삭제/되돌리기).
// 상세 열람/제목편집은 DocumentDetailDrawer로 분리(300줄 제약).

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, FileText, History, Inbox, RotateCcw, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbTable, { type NbColumn } from '@/components/ui/nb/NbTable'
import { useDebounce } from '@/hooks/useDebounce'
import { DOC_TYPES, DOC_TYPE_LABEL, type DocType } from '@/lib/ai-chat/grouping/classify-doc'
import {
  listDocuments,
  deleteDocument,
  restoreDocument,
  type AnalysisDocumentSummary,
  type DocumentSortKey,
} from './document-actions'
import DocumentDetailDrawer from './DocumentDetailDrawer'
import { ConfirmModal } from './SessionListModals'

const SORT_OPTIONS: { value: DocumentSortKey; label: string }[] = [
  { value: 'updated', label: '최근 수정순' },
  { value: 'created', label: '최근 생성순' },
]

function docTypeLabel(t: string | null): string {
  if (t && (DOC_TYPES as readonly string[]).includes(t)) return DOC_TYPE_LABEL[t as DocType]
  return '일반 문서'
}

export default function DocumentListClient() {
  const router = useRouter()
  const sp = useSearchParams()

  const [search, setSearch] = useState(sp.get('q') ?? '')
  const debouncedSearch = useDebounce(search, 300)
  const [sort, setSort] = useState<DocumentSortKey>(sp.get('sort') === 'created' ? 'created' : 'updated')
  const [docType, setDocType] = useState(sp.get('docType') ?? '')
  const [showDeleted, setShowDeleted] = useState(sp.get('deleted') === '1')

  const [documents, setDocuments] = useState<AnalysisDocumentSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [deleting, setDeleting] = useState<AnalysisDocumentSummary | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  useEffect(() => {
    const next = new URLSearchParams(Array.from(sp.entries()))
    next.set('tab', 'documents')
    if (debouncedSearch) next.set('q', debouncedSearch); else next.delete('q')
    if (sort !== 'updated') next.set('sort', sort); else next.delete('sort')
    if (docType) next.set('docType', docType); else next.delete('docType')
    if (showDeleted) next.set('deleted', '1'); else next.delete('deleted')
    router.replace(`?${next.toString()}`, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, sort, docType, showDeleted])

  const load = useCallback(
    async (cursor?: string) => {
      cursor ? setLoadingMore(true) : setLoading(true)
      setError(null)
      const r = await listDocuments({
        q: debouncedSearch || undefined,
        sort,
        filter: { docType: docType || undefined, deleted: showDeleted },
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
    [debouncedSearch, sort, docType, showDeleted],
  )

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, sort, docType, showDeleted])

  async function handleDeleteConfirmed() {
    if (!deleting) return
    const r = showDeleted ? await restoreDocument(deleting.id) : await deleteDocument(deleting.id)
    if (r.ok) {
      setDocuments((prev) => prev.filter((d) => d.id !== deleting.id))
      setDeleting(null)
    }
  }

  const columns: NbColumn<AnalysisDocumentSummary>[] = [
    {
      key: 'title', header: '제목', cardHeader: true,
      render: (d) => <span style={{ fontWeight: 700, color: 'var(--text)' }}>{d.title}</span>,
    },
    {
      key: 'docType', header: '문서유형', label: '문서유형',
      render: (d) => <span className="badge" data-status="planned">{docTypeLabel(d.docType)}</span>,
    },
    {
      key: 'updated', header: '수정일', label: '수정일',
      render: (d) => <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{new Date(d.updatedAt).toLocaleString('ko-KR')}</span>,
    },
    {
      key: 'session', header: '원본 세션', hideOnMobile: true,
      render: (d) =>
        d.sessionId ? (
          <button type="button" onClick={(e) => { e.stopPropagation(); router.push(`/ai-chat/analyze?tab=list`) }}
            style={{ background: 'none', border: 'none', color: 'var(--brand)', textDecoration: 'underline', cursor: 'pointer', fontSize: 'var(--fs-xs)' }}>
            세션 보기
          </button>
        ) : (
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>—</span>
        ),
    },
    {
      key: 'actions', header: '', label: '',
      render: (d) => (
        <div className="card-actions" style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <button type="button" onClick={(e) => { e.stopPropagation(); setDeleting(d) }}
            aria-label={showDeleted ? `${d.title} 되돌리기` : `${d.title} 삭제`}
            title={showDeleted ? '되돌리기' : '삭제'}
            style={{ minHeight: 44, minWidth: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: showDeleted ? 'var(--surface-bg)' : 'var(--danger-bg)',
              border: `var(--hairline) solid ${showDeleted ? 'var(--border-color)' : 'var(--danger-border)'}`,
              borderRadius: 'var(--radius)', color: showDeleted ? 'var(--info)' : 'var(--danger)', cursor: 'pointer' }}>
            {showDeleted ? <RotateCcw size={15} /> : <Trash2 size={14} />}
          </button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <input className="input-field" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="제목·본문 검색" aria-label="문서 검색"
          style={{ flex: '1 1 220px', minWidth: 0, maxWidth: 320, minHeight: 44 }} />
        <select className="input-field" value={sort} onChange={(e) => setSort(e.target.value as DocumentSortKey)}
          aria-label="정렬 기준" style={{ flex: '0 0 auto', width: 'auto', minHeight: 44 }}>
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="input-field" value={docType} onChange={(e) => setDocType(e.target.value)}
          aria-label="문서유형 필터" style={{ flex: '0 0 auto', width: 'auto', minHeight: 44 }}>
          <option value="">전체 유형</option>
          {DOC_TYPES.map((t) => <option key={t} value={t}>{DOC_TYPE_LABEL[t]}</option>)}
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', minHeight: 44 }}>
          <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
          휴지통
        </label>
      </div>

      {error ? (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-5)', borderRadius: 'var(--radius-lg)', border: 'var(--border-w-2) solid var(--danger-border)', background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>
          <AlertTriangle size={18} /> 문서 목록을 불러오지 못했습니다 — {error}
          <button onClick={() => load()} style={{ marginLeft: 'auto', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--danger)', background: 'none', border: 'var(--border-w-2) solid var(--danger-border)', borderRadius: 'var(--radius)', padding: '4px 10px', cursor: 'pointer' }}>다시 시도</button>
        </div>
      ) : loading ? (
        <div style={{ color: 'var(--text-faint)', padding: 'var(--space-6)', textAlign: 'center', fontSize: 'var(--fs-sm)' }}>불러오는 중…</div>
      ) : documents.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-8) var(--space-4)', color: 'var(--text-faint)', textAlign: 'center' }}>
          {showDeleted ? <History size={32} strokeWidth={1.5} /> : <Inbox size={32} strokeWidth={1.5} />}
          <p style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text-muted)' }}>
            {showDeleted ? '삭제된 문서가 없습니다' : debouncedSearch || docType ? '검색 결과가 없습니다' : '아직 저장된 분석 문서가 없습니다'}
          </p>
          {!showDeleted && !debouncedSearch && !docType && (
            <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <FileText size={14} /> 분석 완료 후 &quot;문서함에 저장&quot;을 누르면 여기 쌓입니다
            </p>
          )}
        </div>
      ) : (
        <NbTable columns={columns} rows={documents} getRowKey={(d) => d.id} onRowClick={showDeleted ? undefined : (d) => setDetailId(d.id)} />
      )}

      {nextCursor && !error && (
        <div style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>
          <NbButton variant="secondary" onClick={() => load(nextCursor)} disabled={loadingMore}>
            {loadingMore ? '불러오는 중…' : '더 보기'}
          </NbButton>
        </div>
      )}

      {deleting && (
        <ConfirmModal
          title={showDeleted ? '문서 되돌리기' : '문서 삭제'}
          message={
            showDeleted
              ? <>‘<b style={{ color: 'var(--text)' }}>{deleting.title}</b>’ 문서를 되돌릴까요? 목록에 다시 표시됩니다.</>
              : <>‘<b style={{ color: 'var(--text)' }}>{deleting.title}</b>’ 문서를 삭제할까요? 나중에 휴지통에서 되돌릴 수 있습니다.</>
          }
          confirmLabel={showDeleted ? '되돌리기' : '삭제'}
          danger={!showDeleted}
          onClose={() => setDeleting(null)}
          onConfirm={handleDeleteConfirmed}
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
