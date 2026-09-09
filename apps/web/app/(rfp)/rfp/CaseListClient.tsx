'use client'

// 케이스 목록 — 목록 표준(ListToolbar·ListSurface + useListQuery)을 그대로 쓴다.
// 화면이 말을 짓지 않는다 — 모든 문구는 lib/rfp/terms 에서 온다.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import type { ColumnDef } from '@/components/ui/list/types'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import { useListQuery } from '@/lib/ui/use-list-query'
import { RFP_LIST, RFP_INTAKE, DOC_CLASS_LABEL, STAGE_LABEL } from '@/lib/rfp/terms'
import type { DocClass } from '@/lib/rfp/domain/doc-class'
import type { Stage } from '@/lib/rfp/domain/status'
import type { StatusKey } from '@/lib/tokens/status-colors'

export interface CaseRow {
  id: string
  title: string
  doc_class: DocClass
  stage: Stage
  sector: string | null
  budget_amount: number | null
  proposal_deadline: string | null
  created_at: string
}

const FAINT = { color: 'var(--text-faint)' } as const

/**
 * 등급이 높을수록 눈에 띄어야 한다 — 공개 문서와 NDA 가 같아 보이면 안 된다.
 * 색은 저장소의 상태 키에서 고른다(색을 직접 정하지 않는다).
 */
const DOC_CLASS_STATUS: Record<DocClass, StatusKey> = {
  public: 'note', restricted: 'doing', nda: 'blocker',
}

export default function CaseListClient({ initial }: { initial: CaseRow[] }) {
  const { query, set } = useListQuery({ sort: { key: 'created_at', dir: 'desc' }, view: 'table' })
  const [rows, setRows] = useState<CaseRow[]>(initial)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const q = query.q ?? ''

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/rfp/cases?limit=50', { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) { setError(RFP_LIST.loadFailed); return }
      setRows(body.cases ?? [])
    } catch {
      setError(RFP_LIST.loadFailed)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (initial.length === 0) void load() }, [initial.length, load])

  const visible = useMemo(
    () => (q ? rows.filter((r) => r.title.includes(q)) : rows),
    [rows, q],
  )

  const columns = useMemo<ColumnDef<CaseRow>[]>(() => [
    {
      key: 'title',
      header: RFP_LIST.colTitle,
      primary: true,
      cell: (r) => (
        <>
          <span>{r.title}</span>
          {r.sector && <div style={{ ...FAINT, fontSize: 'var(--fs-xs)' }}>{r.sector}</div>}
        </>
      ),
    },
    {
      key: 'stage',
      header: RFP_LIST.colStage,
      cell: (r) => <NbBadge status="note">{STAGE_LABEL[r.stage] ?? r.stage}</NbBadge>,
    },
    {
      key: 'docClass',
      header: RFP_LIST.colDocClass,
      cell: (r) => (
        <NbBadge status={DOC_CLASS_STATUS[r.doc_class] ?? 'note'}>
          {DOC_CLASS_LABEL[r.doc_class] ?? r.doc_class}
        </NbBadge>
      ),
    },
    {
      key: 'budget',
      header: RFP_LIST.colBudget,
      hideOnCard: true,
      cell: (r) => (r.budget_amount ? r.budget_amount.toLocaleString() : <span style={FAINT}>—</span>),
    },
    {
      key: 'deadline',
      header: RFP_LIST.colDeadline,
      cell: (r) => (r.proposal_deadline
        ? r.proposal_deadline.slice(0, 10)
        : <span style={FAINT}>—</span>),
    },
    {
      key: 'created',
      header: RFP_LIST.colCreated,
      hideOnCard: true,
      cell: (r) => r.created_at.slice(0, 10),
    },
  ], [])

  return (
    <>
      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder={RFP_LIST.searchPlaceholder}
        views={['table', 'card']}
        actions={(
          <NbButton href="/rfp/new">
            <Plus size={14} /> {RFP_INTAKE.title}
          </NbButton>
        )}
      />

      <ListSurface
        rows={visible}
        columns={columns}
        query={query}
        onChange={set}
        rowKey={(r) => r.id}
        // 행 전체가 눌린다 — 상세 버튼만 두면 새 탭·우클릭이 죽는다
        rowHref={(r) => `/rfp/${r.id}`}
        loading={loading && visible.length === 0}
        error={error ? { message: error, onRetry: () => void load() } : null}
        empty={{
          title: q ? RFP_LIST.emptySearchTitle : RFP_LIST.emptyTitle,
          description: q ? RFP_LIST.emptySearchDesc : RFP_LIST.emptyDesc,
          action: q ? undefined : { label: RFP_LIST.emptyAction, href: '/rfp/new' },
        }}
      />

      {/* 상한에 걸렸다는 사실은 말한다 — 조용히 끊기면 「없는 것」으로 읽힌다 */}
      {visible.length >= 50 && (
        <p style={{ ...FAINT, fontSize: 'var(--fs-sm)' }}>{RFP_LIST.limitNotice}</p>
      )}
    </>
  )
}
