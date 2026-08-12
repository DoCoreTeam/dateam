'use client'

// app/(member)/lead-intake/IntakeHistory.tsx — 최근 인테이크 목록(목록 표준 §2-6)
//
// 데이터는 서버 컴포넌트가 이미 20건을 실어 보낸다 — 여기서는 표현만 맡는다.
// 검색·필터·정렬·보기·페이지는 useListQuery가 URL에 두므로 새로고침·공유가 그대로 성립한다.
// 전체를 손에 쥔 목록이라 rangeOf()로 잘라 그린다(서버 재조회 없음).

import { useMemo } from 'react'
import type { LeadIntake } from '@/types/database'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef, ListFilterDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import { rangeOf, type ListDefaults } from '@/lib/ui/list-query'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import IntakeActions from './IntakeActions'

/** 상태 → 공용 배지(.badge[data-status]) — 화면마다 색맵을 복붙하지 않는다 */
const STATUS_META: Record<string, { label: string; status: string }> = {
  pending: { label: '대기', status: 'note' },
  processing: { label: '처리중', status: 'doing' },
  completed: { label: '완료', status: 'done' },
  crm_registered: { label: 'CRM 등록', status: 'planned' },
  failed: { label: '실패', status: 'blocker' },
}

const SOURCE_LABEL: Record<string, string> = {
  prompt: '텍스트', business_card: '명함', card_scan: '명함', file: '파일',
  manual: '직접입력', voice: '음성', xlsx_bulk: '대량파일',
}

// 'target'은 화면에 드롭다운을 만들지 않는다 — 페이지가 제목에 쓰는 진입 스코프다.
// listQueryToParams가 주소를 처음부터 다시 만들기 때문에, 화이트리스트에 없으면
// 검색·정렬 한 번에 ?target=account가 날아가고 "거래처 인테이크"가 "리드 인테이크"로 바뀐다.
const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'created_at', dir: 'desc' },
  view: 'table',
  filterKeys: ['status', 'source', 'target'],
}

const SORT_OPTIONS = [
  { key: 'created_at', label: '일시' },
  { key: 'fit_score', label: 'Fit' },
  { key: 'status', label: '상태' },
]

const TITLE_MAX = 40
const truncate = (s: string) => (s.length > TITLE_MAX ? `${s.substring(0, TITLE_MAX)}…` : s)

function companyOf(intake: LeadIntake): string | null {
  const parsed = intake.parsed_data as unknown as { company_name?: string } | null
  return parsed?.company_name ?? null
}

function fitColor(score: number): string {
  if (score >= 70) return 'var(--success)'
  if (score >= 40) return 'var(--warning)'
  return 'var(--danger)'
}

const ellipsis = {
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
} as const

const COLUMNS: ColumnDef<LeadIntake>[] = [
  {
    key: 'content', header: '내용', primary: true,
    cell: (it) => {
      const company = companyOf(it)
      const title = company ? truncate(company) : (it.raw_input ? truncate(it.raw_input) : '파일 업로드')
      const sub = company && it.raw_input ? truncate(it.raw_input) : null
      return (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 'var(--fs-base)', ...ellipsis }}>{title}</div>
          {sub && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: '0.125rem', ...ellipsis }}>{sub}</div>}
        </div>
      )
    },
  },
  {
    key: 'source', header: '출처',
    cell: (it) => <span className="badge badge-slate" style={{ fontSize: 'var(--fs-xs)' }}>{SOURCE_LABEL[it.source] ?? it.source}</span>,
  },
  {
    key: 'status', header: '상태', sortable: 'status',
    cell: (it) => {
      const meta = STATUS_META[it.status]
      if (!meta) return <span className="badge badge-slate" style={{ fontSize: 'var(--fs-xs)' }}>{it.status}</span>
      return <span className="badge" data-status={meta.status} style={{ fontSize: 'var(--fs-xs)' }}>{meta.label}</span>
    },
  },
  {
    key: 'fit_score', header: 'Fit', sortable: 'fit_score', align: 'right',
    cell: (it) => it.fit_score !== null
      ? <span style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: fitColor(it.fit_score) }}>{it.fit_score}점</span>
      : <span style={{ color: 'var(--text-faint)' }}>-</span>,
  },
  {
    key: 'created_at', header: '일시', sortable: 'created_at', hideOnCard: true,
    cell: (it) => <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{formatKstDateTimeShort(it.created_at)}</span>,
  },
  {
    key: 'actions', header: '관리', width: '120px',
    cell: (it) => <IntakeActions intakeId={it.id} notes={it.notes} />,
  },
]

function sortValue(intake: LeadIntake, key: string): string | number {
  if (key === 'fit_score') return intake.fit_score ?? -1
  if (key === 'status') return intake.status
  return intake.created_at
}

export default function IntakeHistory({ intakes }: { intakes: LeadIntake[] }) {
  const { query, set } = useListQuery(LIST_DEFAULTS, { persistKey: '/lead-intake' })
  const { q, sort, filters } = query

  // 필터 선택지는 실제로 들어온 값에서만 만든다 — 고르면 0건인 항목을 보여주지 않는다
  const filterDefs: ListFilterDef[] = useMemo(() => {
    // Array.from — tsconfig에 target/downlevelIteration이 없어 Set 스프레드는 컴파일되지 않는다(레포 관례)
    const uniq = (pick: (i: LeadIntake) => string) => Array.from(new Set(intakes.map(pick)))
    return [
      {
        key: 'status', label: '상태',
        options: uniq((i) => i.status).map((v) => ({ value: v, label: STATUS_META[v]?.label ?? v })),
      },
      {
        key: 'source', label: '출처',
        options: uniq((i) => i.source).map((v) => ({ value: v, label: SOURCE_LABEL[v] ?? v })),
      },
    ]
  }, [intakes])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const matched = intakes.filter((it) => {
      if (filters.status && it.status !== filters.status) return false
      if (filters.source && it.source !== filters.source) return false
      if (!needle) return true
      return [it.raw_input, companyOf(it), it.notes]
        .some((v) => v?.toLowerCase().includes(needle))
    })
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...matched].sort((a, b) => {
      const av = sortValue(a, sort.key)
      const bv = sortValue(b, sort.key)
      if (av === bv) return 0
      return (av < bv ? -1 : 1) * dir
    })
  }, [intakes, q, filters.status, filters.source, sort.key, sort.dir])

  const { from, to } = rangeOf(query)
  const pageRows = rows.slice(from, to + 1)
  const narrowed = Boolean(q || filters.status || filters.source)

  return (
    <>
      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="회사명 또는 입력 내용 검색"
        filters={filterDefs}
        sortOptions={SORT_OPTIONS}
        total={rows.length}
        // 서버가 20건으로 고정해 보내므로 개수 선택은 안 먹는다 — 안 먹는 선택지를 두지 않는다
        showSize={false}
      />

      <ListSurface
        rows={pageRows}
        columns={COLUMNS}
        query={query}
        rowKey={(it) => it.id}
        onChange={set}
        empty={narrowed
          ? { title: '조건에 맞는 인테이크가 없어요', description: '검색어나 상태·출처 필터를 바꿔보세요' }
          : { title: '아직 인테이크 기록이 없어요', description: '위 입력창에 미팅 메모를 붙여넣거나 명함·파일을 올리면 여기에 쌓입니다' }}
      />

      <ListPager query={query} total={rows.length} onChange={set} />
    </>
  )
}
