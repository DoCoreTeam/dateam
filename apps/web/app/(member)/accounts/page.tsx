'use client'

// app/(member)/accounts/page.tsx — 거래처 목록
// 목록 표준(§2-6)을 따른다 — 담당자·영업기회와 같은 도구줄·표/카드·페이지 규격.

import { useCallback, useEffect, useState } from 'react'
import useSWRInfinite from 'swr/infinite'
import Link from 'next/link'
import { Plus, MapPin, ExternalLink, Sparkles } from 'lucide-react'
import ContactLink from '@/components/ui/ContactLink'
import type { Account } from '@/types/database'
import AccountActions from './AccountActions'
import SlidePanel from '@/components/ui/SlidePanel'
import PageHeader from '@/components/ui/PageHeader'
import ProjectTabs from '@/components/ui/ProjectTabs'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import type { ListDefaults } from '@/lib/ui/list-query'
import { ACCOUNT_SEGMENTS } from '@/lib/crm'

type PageData = { items: Account[]; nextCursor: string | null; hasMore: boolean; capped?: boolean }

const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'created_at', dir: 'desc' },
  mode: 'more',
  view: 'table',
  filterKeys: ['segment'],
}
const SORT_OPTIONS = [
  { key: 'created_at', label: '등록일' },
  { key: 'name', label: '거래처명' },
  { key: 'fit_score', label: 'Fit 점수' },
  { key: 'industry', label: '업종' },
  { key: 'region', label: '지역' },
  { key: 'gpu_demand_intensity', label: 'GPU 수요' },
]
const FILTERS = [{
  key: 'segment',
  label: '세그먼트',
  options: ACCOUNT_SEGMENTS.map((s) => ({ value: s, label: s })),
}]

function fitColor(score: number | null) {
  if (score === null) return { color: 'var(--text-faint)', background: 'var(--color-bg)' }
  if (score >= 70) return { color: 'var(--success)', background: 'var(--success-bg)' }
  if (score >= 40) return { color: 'var(--warning)', background: 'var(--warning-bg)' }
  return { color: 'var(--danger)', background: 'var(--danger-bg)' }
}

const dash = <span style={{ color: 'var(--text-faint)' }}>-</span>

const COLUMNS: ColumnDef<Account>[] = [
  {
    key: 'name', header: '거래처명', primary: true, sortable: 'name',
    cell: (a) => (
      <div>
        <span style={{ fontWeight: 600, color: 'var(--text)', fontSize: 'var(--fs-md)' }}>{a.name}</span>
        {a.industry && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: '0.125rem' }}>{a.industry}</div>}
      </div>
    ),
  },
  { key: 'industry', header: '업종', sortable: 'industry', hideOnCard: true, cell: (a) => a.industry ?? dash },
  {
    key: 'segment', header: '세그먼트',
    cell: (a) => a.segment
      ? <span className="badge badge-indigo" style={{ fontSize: 'var(--fs-xs)' }}>{a.segment}</span>
      : dash,
  },
  { key: 'region', header: '지역', sortable: 'region', cell: (a) => a.region ?? dash },
  {
    key: 'gpu_demand_intensity', header: 'GPU수요', sortable: 'gpu_demand_intensity',
    cell: (a) => a.gpu_demand_intensity
      ? <span className={`badge ${a.gpu_demand_intensity === 'High' ? 'badge-indigo' : 'badge-slate'}`} style={{ fontSize: 'var(--fs-xs)' }}>{a.gpu_demand_intensity}</span>
      : dash,
  },
  {
    key: 'account_type', header: '거래처유형', hideOnCard: true,
    cell: (a) => a.account_type
      ? <span className="badge badge-slate" style={{ fontSize: 'var(--fs-xs)' }}>{a.account_type}</span>
      : dash,
  },
  {
    key: 'fit_score', header: 'Fit', sortable: 'fit_score', align: 'right',
    cell: (a) => a.fit_score !== null
      ? <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '9999px', ...fitColor(a.fit_score) }}>{a.fit_score}</span>
      : dash,
  },
  {
    key: 'actions', header: '관리', width: '80px',
    // 행 클릭(상세 열기)과 겹치지 않게 이벤트를 여기서 끊는다
    cell: (a) => <span onClick={(e) => e.stopPropagation()}><AccountActions accountId={a.id} /></span>,
  },
]

export default function AccountsPage() {
  const { query, set } = useListQuery(LIST_DEFAULTS, { persistKey: '/accounts' })
  const [selected, setSelected] = useState<Account | null>(null)

  const getKey = useCallback((pageIndex: number, prev: PageData | null) => {
    if (pageIndex > 0 && !prev?.nextCursor) return null
    const params = new URLSearchParams()
    if (query.q) params.set('search', query.q)
    if (query.filters.segment) params.set('segment', query.filters.segment)
    if (query.sort.key !== 'created_at') params.set('sort', query.sort.key)
    if (query.sort.dir !== 'desc') params.set('dir', query.sort.dir)
    if (prev?.nextCursor) params.set('cursor', prev.nextCursor)
    const qs = params.toString()
    return `/api/accounts${qs ? `?${qs}` : ''}`
  }, [query.q, query.filters.segment, query.sort.key, query.sort.dir])

  const { data, size, setSize, isLoading, isValidating, mutate, error } = useSWRInfinite<PageData>(getKey)

  // '더 보기'는 URL(page)이 진실 — 새로고침해도 보던 만큼 다시 불러온다
  useEffect(() => { if (size !== query.page) setSize(query.page) }, [query.page, size, setSize])

  const accounts = data?.flatMap((p) => p.items) ?? []
  const last = data?.[data.length - 1]
  const hasFilters = Boolean(query.q || query.filters.segment) || query.sort.key !== 'created_at'

  return (
    <div className="page-inner">
      <PageHeader title="거래처" description="고객사 및 잠재 거래처 관리" actions={
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Link href="/lead-intake?target=account" className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius)', minHeight: '44px' }}>
            <Sparkles size={16} /> AI로 추가
          </Link>
          <Link href="/accounts/new?mode=manual" className="btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', padding: 'var(--space-2) var(--space-4)', minHeight: '44px' }}>
            <Plus size={16} /> 수동 입력
          </Link>
        </div>
      } 
        below={<ProjectTabs />}
      />

      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="거래처명 검색"
        filters={FILTERS}
        sortOptions={SORT_OPTIONS}
        showSize={false}
        total={isLoading ? undefined : accounts.length}
      />

      <ListSurface
        rows={accounts}
        columns={COLUMNS}
        query={query}
        rowKey={(a) => a.id}
        onChange={set}
        loading={isLoading}
        error={error ? { message: '거래처 목록을 불러오지 못했습니다', onRetry: () => { void mutate() } } : null}
        empty={hasFilters
          ? { title: '조건에 맞는 거래처가 없어요', description: '검색어나 세그먼트를 바꿔보세요' }
          : { title: '아직 등록된 거래처가 없어요', description: '이름만 넣어도 AI가 나머지를 채워줍니다', action: { label: 'AI로 첫 거래처 추가', href: '/lead-intake?target=account' } }}
        onRowClick={(a) => setSelected(a)}
      />

      <ListPager query={query} hasMore={last?.hasMore ?? false} onChange={set} loading={isValidating && !isLoading} />

      {last?.capped && (
        <p style={{ textAlign: 'center', padding: 'var(--space-3)', fontSize: 'var(--fs-sm)', color: 'var(--warning)' }}>
          결과가 500건을 초과합니다. 검색 조건을 좁혀주세요.
        </p>
      )}

      <SlidePanel isOpen={!!selected} onClose={() => setSelected(null)} title={selected?.name ?? ''}>
        {selected && <AccountDetail account={selected} onClose={() => setSelected(null)} onDeleted={() => { void mutate(); setSelected(null) }} />}
      </SlidePanel>
    </div>
  )
}

function AccountDetail({ account, onClose, onDeleted }: { account: Account; onClose: () => void; onDeleted: () => void }) {
  async function handleDelete() {
    if (!confirm(`거래처 "${account.name}"을(를) 삭제하시겠습니까?`)) return
    const res = await fetch(`/api/accounts/${account.id}`, { method: 'DELETE' })
    if (res.ok) onDeleted()
    else alert('삭제에 실패했습니다')
  }
  const fc = fitColor(account.fit_score)
  return (
    <div>
      {/* 배지 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '1rem' }}>
        {account.industry && <span className="badge badge-slate">{account.industry}</span>}
        {account.segment  && <span className="badge badge-indigo">{account.segment}</span>}
        {account.size     && <span className="badge" style={{ background: 'var(--color-bg)', color: 'var(--text-muted)' }}>{account.size}</span>}
        {account.account_type && <span className="badge" style={{ background: 'var(--warning-bg)', color: 'var(--warning)', fontSize: 'var(--fs-xs)' }}>{account.account_type}</span>}
        {account.gpu_demand_intensity && (
          <span className={`badge ${account.gpu_demand_intensity === 'High' ? 'badge-indigo' : 'badge-slate'}`} style={{ fontSize: 'var(--fs-xs)' }}>
            GPU {account.gpu_demand_intensity}
          </span>
        )}
        {account.fit_score !== null && (
          <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, padding: '0.2rem 0.625rem', borderRadius: '9999px', ...fc }}>
            Fit {account.fit_score}점
          </span>
        )}
      </div>

      {/* 기본 정보 */}
      <div className="detail-info-list">
        {account.website && (
          <div className="detail-info-row">
            <ContactLink kind="domain" value={account.website} />
          </div>
        )}
        {account.phone && (
          <div className="detail-info-row">
            <ContactLink kind="phone" value={account.phone} />
          </div>
        )}
        {(account.region || account.address) && (
          <div className="detail-info-row">
            <MapPin size={14} color="var(--brand)" style={{ flexShrink: 0 }} />
            <span>{[account.region, account.address].filter(Boolean).join(' · ')}</span>
          </div>
        )}
        {account.description && (
          <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text)', lineHeight: 1.6, margin: '0.25rem 0 0' }}>
            {account.description}
          </p>
        )}
        {account.tags?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.25rem' }}>
            {account.tags.map(tag => (
              <span key={tag} className="badge" style={{ background: 'var(--info-bg)', color: 'var(--info)', fontSize: 'var(--fs-xs)' }}>#{tag}</span>
            ))}
          </div>
        )}
      </div>

      <div className="detail-actions">
        <Link href={`/accounts/${account.id}`} className="detail-btn-primary" onClick={onClose}>
          <ExternalLink size={14} /> 전체 보기
        </Link>
        <Link href={`/accounts/${account.id}/edit`} className="detail-btn-ghost" onClick={onClose}>
          편집
        </Link>
        <button onClick={handleDelete} className="detail-btn-ghost" style={{ color: 'var(--danger)', borderColor: 'var(--danger-border)', cursor: 'pointer' }}>
          삭제
        </button>
      </div>
    </div>
  )
}
