'use client'

// 회사 목록 (dacrm T1-02)
//
// 호스트 목록 표준(§2-6)을 그대로 쓴다 — ListToolbar·ListSurface·ListPager + useListQuery.
// 새 목록 부품을 만들지 않는다. 검색어·보기는 URL 이 진실이라 링크를 공유하면 같은 화면이 열린다.
//
// 페이지 이동은 'more' 모드다(커서 API — 목록이 움직여도 같은 회사를 두 번 보지 않는다).
// 다만 **총 건수는 보여 준다.** 예전엔 그마저 없어서 372건이 들어와도 화면은
// 20건씩 '더 보기'만 반복하고 규모를 알 길이 없었다 — 끝이 안 보이는 목록은 사람이 끝낼 수 없다.
// count 는 첫 페이지 1회뿐이다(lib/crm/db/cursor.ts countIfFirstPage).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Sparkles } from 'lucide-react'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import NbButton from '@/components/ui/nb/NbButton'
import {
  TRASH_FILTER, TRASH_FILTER_KEYS, TRASH_EMPTY, isTrashView, useRestore, restoreColumn,
} from '@/components/ui/crm/trash'
import InlineError from '@/components/ui/InlineError'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { useRowSelection } from '@/hooks/useRowSelection'
import { useListQuery } from '@/lib/ui/use-list-query'
import { ENRICH_BULK_MAX } from '@/lib/crm/domain/enrich-limits'
import CompanyFormModal from './CompanyFormModal'

/** 서버(`services/enrich-web.ts`)가 돌려주는 회사 한 곳의 결과 */
interface EnrichOne {
  companyId: string
  name: string
  matched: boolean
  matchReason: string | null
  suggested: number
  applied: number
  skipped: boolean
}

interface EnrichSummary {
  results: EnrichOne[]
  enriched: number
  applied: number
  suggested: number
  failed: { companyId: string; message: string }[]
}

export interface CompanyItem {
  id: string
  name: string
  domain: string | null
  industry: string | null
  region: string | null
  version: number
  updatedAt: string
}

const COLUMNS: ColumnDef<CompanyItem>[] = [
  { key: 'name', header: '회사명', primary: true, cell: (r) => r.name },
  {
    key: 'domain',
    header: '도메인',
    cell: (r) => r.domain ?? <span style={{ color: 'var(--text-faint)' }}>—</span>,
  },
  {
    key: 'industry',
    header: '산업',
    cell: (r) => r.industry ?? <span style={{ color: 'var(--text-faint)' }}>—</span>,
  },
  {
    key: 'region',
    header: '지역',
    hideOnCard: true,
    cell: (r) => r.region ?? <span style={{ color: 'var(--text-faint)' }}>—</span>,
  },
]

export default function CompanyListView() {
  const { query, set } = useListQuery({
    view: 'table', size: 20, sort: { key: 'updatedAt', dir: 'desc' }, mode: 'more',
    filterKeys: [...TRASH_FILTER_KEYS],
  })
  const [rows, setRows] = useState<CompanyItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  // 서버는 첫 페이지에서만 총 건수를 준다 — 이어 볼 때는 이미 아는 값을 그대로 쓴다
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  // AI 보강 — 진행 중 여부·결과·실패를 따로 든다.
  // 실패를 결과 안에 섞으면 "성공 0건"과 "아예 못 불렀다"가 같은 화면이 된다.
  const [enriching, setEnriching] = useState(false)
  const [enrichResult, setEnrichResult] = useState<EnrichSummary | null>(null)
  const [enrichError, setEnrichError] = useState<string | null>(null)

  const q = query.q ?? ''
  const trash = isTrashView(query)

  const load = useCallback(async (append: boolean, nextCursor: string | null) => {
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams()
      if (q) sp.set('q', q)
      if (trash) sp.set('trash', '1')
      sp.set('limit', String(query.size))
      if (nextCursor) sp.set('cursor', nextCursor)

      const res = await fetch(`/api/crm/companies?${sp.toString()}`)
      const body = await res.json()
      if (!res.ok) {
        // 실패를 조용히 삼키지 않는다 — 서버가 준 문장을 그대로 보여 준다
        setError(body?.error?.message ?? '목록을 불러오지 못했습니다.')
        return
      }
      setRows((prev) => (append ? [...prev, ...body.items] : body.items))
      setCursor(body.nextCursor)
      if (!append) setTotal(typeof body.total === 'number' ? body.total : undefined)
    } catch {
      setError('목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [q, trash, query.size])

  // 검색어·개수가 바뀌면 처음부터 다시 — 커서를 이어 쓰면 조건이 섞인다
  useEffect(() => { void load(false, null) }, [load])

  const selection = useRowSelection(rows, (r) => r.id)

  /**
   * 고른 회사들을 웹에서 찾아 빈 칸을 채운다.
   *
   * 끝나면 **목록을 다시 불러온다** — 자동 반영된 값이 화면에 보여야
   * 사용자가 "됐다"를 응답 문구가 아니라 **자기 눈으로** 확인한다.
   * 인박스로 간 건은 목록이 그대로이므로, 요약이 그 수를 따로 말한다.
   */
  const runEnrich = useCallback(async () => {
    const ids = selection.selectedIds
    if (ids.length === 0 || enriching) return

    setEnriching(true)
    setEnrichError(null)
    setEnrichResult(null)
    try {
      const res = await fetch('/api/crm/companies/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyIds: ids }),
      })
      const body = await res.json()
      if (!res.ok) {
        // 서버가 준 문장을 그대로 보여 준다 — 우리 말로 바꾸면 원인이 흐려진다
        setEnrichError(body?.error?.message ?? 'AI 보강에 실패했습니다.')
        return
      }
      setEnrichResult(body as EnrichSummary)
      selection.clear()
      await load(false, null)
    } catch {
      setEnrichError('AI 보강을 실행하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setEnriching(false)
    }
  }, [selection, enriching, load])

  const { restore, restoreError } = useRestore('/api/crm/companies', () => void load(false, null))
  const columns = useMemo<ColumnDef<CompanyItem>[]>(
    () => (trash ? [...COLUMNS, restoreColumn<CompanyItem>((id) => void restore(id))] : COLUMNS),
    [trash, restore],
  )

  return (
    <>
      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="회사명·도메인으로 검색"
        views={['table', 'card']}
        filters={[TRASH_FILTER]}
        selection={trash ? undefined : {
          count: selection.count,
          onClear: selection.clear,
          actions: (
            <>
              <NbButton
                onClick={() => void runEnrich()}
                disabled={enriching || selection.count > ENRICH_BULK_MAX}
              >
                {enriching ? <AXDotLoader /> : <Sparkles size={16} />}
                {enriching ? 'AI가 찾는 중…' : 'AI로 채우기'}
              </NbButton>
              {selection.count > ENRICH_BULK_MAX && (
                <InlineError compact>한 번에 {ENRICH_BULK_MAX}곳까지예요. 나눠서 눌러 주세요.</InlineError>
              )}
            </>
          ),
        }}
        actions={
          <NbButton onClick={() => setFormOpen(true)}>
            <Plus size={16} /> 회사 추가
          </NbButton>
        }
      />

      {enrichError && <InlineError banner onDismiss={() => setEnrichError(null)}>{enrichError}</InlineError>}

      {enrichResult && (
        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <p style={{ margin: 0, fontWeight: 600, color: 'var(--text)' }}>
            {/*
              전부 실패했을 때 "바로 채운 칸은 없어요"로 시작하면 사실이긴 해도
              **아무 일도 안 일어난 것처럼** 읽힌다. 실패가 있으면 실패부터 말한다.
            */}
            {enrichResult.applied > 0
              ? `${enrichResult.applied}칸을 바로 채웠어요.`
              : enrichResult.results.length === 0 && enrichResult.failed.length > 0
                ? 'AI 보강을 실행하지 못했어요.'
                : '바로 채운 칸은 없어요.'}
            {enrichResult.suggested > 0 && ` 확인이 필요한 ${enrichResult.suggested}건은 인박스로 보냈어요.`}
          </p>

          {/*
            회사별 결과를 그대로 보여 준다. 합계만 말하면 "왜 우리 회사는 안 채워졌지"를
            사용자가 알 길이 없고, 그 답이 바로 matchReason 이다.
          */}
          <ul style={{ margin: 'var(--space-3) 0 0', paddingLeft: 'var(--space-5)', display: 'grid', gap: 'var(--space-1)' }}>
            {enrichResult.results.map((r) => (
              <li key={r.companyId} style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                <strong style={{ color: 'var(--text)' }}>{r.name}</strong>
                {' — '}
                {r.skipped
                  ? '채울 빈 칸이 없었어요'
                  : r.matched
                    ? `${r.applied > 0 ? `${r.applied}칸 채움` : ''}${r.applied > 0 && r.suggested > 0 ? ' · ' : ''}${r.suggested > 0 ? `${r.suggested}건 인박스` : ''}${r.applied === 0 && r.suggested === 0 ? '새로 채울 값이 없었어요' : ''}`
                    : (r.matchReason ?? '웹에서 이 회사를 특정하지 못했어요')}
              </li>
            ))}
            {enrichResult.failed.map((f) => (
              <li key={f.companyId} style={{ fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>
                {f.message}
              </li>
            ))}
          </ul>

          <div style={{ marginTop: 'var(--space-3)' }}>
            <NbButton variant="secondary" onClick={() => setEnrichResult(null)}>닫기</NbButton>
          </div>
        </div>
      )}

      <ListSurface
        rows={rows}
        columns={columns}
        query={query}
        onChange={set}
        rowKey={(r) => r.id}
        rowHref={trash ? undefined : (r) => `/crm/companies/${r.id}`}
        selection={trash ? undefined : {
          selected: new Set(selection.selectedIds),
          onToggle: selection.toggle,
          onToggleAll: selection.toggleAll,
          allSelected: selection.allSelected,
          someSelected: selection.someSelected,
          rowLabel: (r) => `${r.name} 선택`,
        }}
        loading={loading && rows.length === 0}
        error={(error ?? restoreError) ? { message: (error ?? restoreError)!, onRetry: () => void load(false, null) } : null}
        empty={trash ? TRASH_EMPTY : {
          title: q ? '검색 결과가 없어요' : '등록된 회사가 아직 없어요',
          description: q
            ? '다른 이름이나 도메인으로 찾아보세요.'
            : '거래처를 추가하면 담당자와 딜을 이어서 만들 수 있습니다.',
          action: q ? undefined : { label: '회사 추가', onClick: () => setFormOpen(true) },
        }}
      />

      <ListPager
        query={query}
        total={total}
        loaded={rows.length}
        hasMore={Boolean(cursor)}
        loading={loading}
        onChange={() => void load(true, cursor)}
      />

      {formOpen && (
        <CompanyFormModal
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); void load(false, null) }}
        />
      )}
    </>
  )
}
