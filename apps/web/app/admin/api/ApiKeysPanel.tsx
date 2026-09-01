'use client'

// app/admin/api/ApiKeysPanel.tsx — API 키 목록
//
// 목록 표준(§2-6). 데이터 조회는 서버(page.tsx)가 그대로 하고 표현만 표준 부품으로 옮겼다.
// `tab`을 filterKeys에 넣는 이유는 AccessRequestsPanel과 같다 — 정렬·검색이 `?tab=keys`를 지우면 안 된다.

import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import { rangeOf, type ListDefaults, type ListQuery } from '@/lib/ui/list-query'
import RevokeKeyButton from '../api-keys/RevokeKeyButton'

export interface ApiKeyRow {
  id: string
  user_id: string
  name: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
  request_count: number
  rate_limit_per_minute: number
}

interface Props {
  activeKeys: ApiKeyRow[]
  revokedKeys: ApiKeyRow[]
  nameMap: Record<string, string | null>
  emailMap: Record<string, string>
}

const ACTIVE_DEFAULTS: ListDefaults = {
  sort: { key: 'created_at', dir: 'desc' },
  view: 'table',
  size: 20,
  filterKeys: ['tab'],
}

const SORT_OPTIONS = [
  { key: 'created_at', label: '생성일' },
  { key: 'name', label: '이름' },
  { key: 'request_count', label: '요청 수' },
  { key: 'last_used_at', label: '마지막 사용' },
]

/** 폐기 키는 참고용이라 조건 없이 그대로 보여준다 */
const REVOKED_QUERY: ListQuery = {
  q: '', sort: { key: 'revoked_at', dir: 'desc' }, filters: {},
  view: 'table', size: 100, mode: 'pages', page: 1,
}

function maskKey(prefix: string): string {
  return `${prefix}${'•'.repeat(20)}`
}

function fmt(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function ApiKeysPanel({ activeKeys, revokedKeys, nameMap, emailMap }: Props) {
  const { query, set } = useListQuery(ACTIVE_DEFAULTS, { persistKey: '/admin/api#keys' })

  function owner(k: ApiKeyRow) {
    return (
      <span>
        <span style={{ fontSize: 'var(--fs-sm)', display: 'block' }}>{nameMap[k.user_id] ?? '—'}</span>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          {emailMap[k.user_id] ?? k.user_id.slice(0, 8)}
        </span>
      </span>
    )
  }

  const activeColumns: ColumnDef<ApiKeyRow>[] = [
    {
      key: 'name', header: '이름', primary: true, sortable: 'name',
      cell: (k) => <span style={{ fontWeight: 600 }}>{k.name}</span>,
    },
    { key: 'user', header: '사용자', cell: owner },
    {
      key: 'key_prefix', header: '마스킹 키', hideOnCard: true,
      cell: (k) => <code style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{maskKey(k.key_prefix)}</code>,
    },
    {
      key: 'request_count', header: '요청 수', sortable: 'request_count', align: 'right',
      cell: (k) => <span style={{ fontSize: 'var(--fs-sm)' }}>{k.request_count.toLocaleString()}회</span>,
    },
    {
      key: 'last_used_at', header: '마지막 사용', sortable: 'last_used_at', hideOnCard: true,
      cell: (k) => <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{fmt(k.last_used_at)}</span>,
    },
    {
      key: 'created_at', header: '생성일', sortable: 'created_at', hideOnCard: true,
      cell: (k) => <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{fmt(k.created_at)}</span>,
    },
    { key: 'revoke', header: '폐기', width: '110px', cell: (k) => <RevokeKeyButton keyId={k.id} keyName={k.name} /> },
  ]

  const revokedColumns: ColumnDef<ApiKeyRow>[] = [
    {
      key: 'name', header: '이름', primary: true,
      cell: (k) => <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>{k.name}</span>,
    },
    { key: 'user', header: '사용자', cell: (k) => nameMap[k.user_id] ?? emailMap[k.user_id] ?? '—' },
    {
      key: 'revoked_at', header: '폐기일',
      cell: (k) => <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{fmt(k.revoked_at)}</span>,
    },
    {
      key: 'request_count', header: '요청 수', align: 'right',
      cell: (k) => <span style={{ fontSize: 'var(--fs-sm)' }}>{k.request_count.toLocaleString()}회</span>,
    },
  ]

  const q = query.q.trim().toLowerCase()
  const filtered = activeKeys
    .filter((k) => {
      if (!q) return true
      const who = `${nameMap[k.user_id] ?? ''} ${emailMap[k.user_id] ?? ''}`.toLowerCase()
      return k.name.toLowerCase().includes(q) || who.includes(q) || k.key_prefix.toLowerCase().includes(q)
    })
    .sort((a, b) => {
      const key = query.sort.key
      let cmp: number
      if (key === 'name') cmp = a.name.localeCompare(b.name, 'ko')
      else if (key === 'request_count') cmp = a.request_count - b.request_count
      else if (key === 'last_used_at') cmp = (a.last_used_at ?? '').localeCompare(b.last_used_at ?? '')
      else cmp = a.created_at.localeCompare(b.created_at)
      return query.sort.dir === 'asc' ? cmp : -cmp
    })

  const { from, to } = rangeOf(query)
  const rows = filtered.slice(from, to + 1)

  return (
    <>
      <div className="card card-flush" style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{
          padding: 'var(--space-5) var(--space-6)', borderBottom: 'var(--border-w-2) solid var(--border-color)',
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        }}>
          <h2 className="tape-title" style={{ margin: 0 }}>활성 키</h2>
          <span className="badge" data-status="done">{activeKeys.length}개</span>
        </div>
        <ListToolbar
          query={query}
          onChange={set}
          searchPlaceholder="키 이름 · 사용자 · 접두사 검색"
          sortOptions={SORT_OPTIONS}
          total={filtered.length}
        />
        <ListSurface
          rows={rows}
          columns={activeColumns}
          query={query}
          rowKey={(k) => k.id}
          onChange={set}
          empty={q
            ? { title: '조건에 맞는 키가 없어요', description: '검색어를 바꿔보세요' }
            : {
              title: '발급된 API 키가 없어요',
              description: '접근 신청을 승인하면 사용자가 키를 발급할 수 있습니다',
              action: { label: 'API 접근 신청 보기', href: '/admin/api?tab=access' },
            }}
        />
        <ListPager query={query} total={filtered.length} onChange={set} />
      </div>

      {revokedKeys.length > 0 && (
        <div className="card card-flush">
          <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: 'var(--border-w-2) solid var(--border-color)' }}>
            <h2 className="tape-title" style={{ margin: 0 }}>폐기된 키 ({revokedKeys.length})</h2>
          </div>
          <ListSurface
            rows={revokedKeys}
            columns={revokedColumns}
            query={REVOKED_QUERY}
            rowKey={(k) => k.id}
            empty={{ title: '폐기된 키가 없어요' }}
          />
        </div>
      )}
    </>
  )
}
