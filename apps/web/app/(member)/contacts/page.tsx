'use client'

// app/(member)/contacts/page.tsx — 담당자 목록
// 목록 표준(ListToolbar/ListSurface/ListPager + useListQuery)을 쓰는 기준 화면이다.
// 검색·정렬·보기는 URL이 진실이라 공유·새로고침·뒤로가기가 그대로 성립한다.

import { useCallback, useEffect, useState } from 'react'
import useSWRInfinite from 'swr/infinite'
import Link from 'next/link'
import { Plus, Mail, Phone, ExternalLink, Briefcase, Sparkles } from 'lucide-react'
import type { Contact, Account } from '@/types/database'
import SlidePanel from '@/components/ui/SlidePanel'
import PageHeader from '@/components/ui/PageHeader'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import type { ListDefaults } from '@/lib/ui/list-query'

type ContactWithAccount = Contact & { accounts: Pick<Account, 'id' | 'name'> | null }
type PageData = { items: ContactWithAccount[]; nextCursor: string | null; hasMore: boolean; capped?: boolean }

// 커서 API라 페이지 크기는 서버가 정한다 → 목록 도구에서 개수 선택을 숨긴다
const LIST_DEFAULTS: ListDefaults = { sort: { key: 'created_at', dir: 'desc' }, mode: 'more', view: 'table' }
const SORT_OPTIONS = [
  { key: 'created_at', label: '등록일' },
  { key: 'name', label: '이름' },
  { key: 'title', label: '직책' },
  { key: 'department', label: '부서' },
]

const COLUMNS: ColumnDef<ContactWithAccount>[] = [
  {
    key: 'name', header: '담당자', primary: true, sortable: 'name',
    cell: (c) => (
      <div>
        <span style={{ fontWeight: 600, color: 'var(--text)', fontSize: 'var(--fs-md)' }}>{c.name}</span>
        {c.accounts?.name && (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: '0.125rem' }}>{c.accounts.name}</div>
        )}
      </div>
    ),
  },
  {
    key: 'title', header: '직책/부서', sortable: 'title',
    cell: (c) => (
      <div>
        {c.title && <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text)' }}>{c.title}</div>}
        {c.department && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{c.department}</div>}
      </div>
    ),
  },
  {
    key: 'contact', header: '연락처',
    cell: (c) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {c.email && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <Mail size={12} color="var(--text-faint)" />
            <a href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()}
              style={{ fontSize: 'var(--fs-sm)', color: 'var(--brand)', textDecoration: 'none' }}>{c.email}</a>
          </span>
        )}
        {(c.mobile ?? c.phone) && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <Phone size={12} color="var(--text-faint)" />
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>{c.mobile ?? c.phone}</span>
          </span>
        )}
      </div>
    ),
  },
  {
    key: 'role', header: '역할',
    cell: (c) => c.role
      ? <span className="badge badge-slate" style={{ fontSize: 'var(--fs-xs)' }}>{c.role}</span>
      : <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>-</span>,
  },
  {
    key: 'account', header: '거래처', hideOnCard: true,
    cell: (c) => c.accounts?.name
      ? (
        <Link href={`/accounts/${c.account_id}`} onClick={(e) => e.stopPropagation()}
          style={{ fontSize: 'var(--fs-base)', color: 'var(--brand)', textDecoration: 'none' }}>
          {c.accounts.name}
        </Link>
      )
      : <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>-</span>,
  },
]

export default function ContactsPage() {
  const { query, set } = useListQuery(LIST_DEFAULTS, { persistKey: '/contacts' })
  const [selected, setSelected] = useState<ContactWithAccount | null>(null)

  const getKey = useCallback((pageIndex: number, prev: PageData | null) => {
    if (pageIndex > 0 && !prev?.nextCursor) return null
    const params = new URLSearchParams()
    if (query.q) params.set('search', query.q)
    if (query.sort.key !== 'created_at') params.set('sort', query.sort.key)
    if (query.sort.dir !== 'desc') params.set('dir', query.sort.dir)
    if (prev?.nextCursor) params.set('cursor', prev.nextCursor)
    const qs = params.toString()
    return `/api/contacts${qs ? `?${qs}` : ''}`
  }, [query.q, query.sort.key, query.sort.dir])

  const { data, size, setSize, isLoading, isValidating, mutate, error } = useSWRInfinite<PageData>(getKey)

  // '더 보기'는 URL(page)이 진실이다 — 새로고침해도 보던 만큼 다시 불러온다
  useEffect(() => { if (size !== query.page) setSize(query.page) }, [query.page, size, setSize])

  const contacts = data?.flatMap((p) => p.items) ?? []
  const last = data?.[data.length - 1]
  const hasFilters = Boolean(query.q) || query.sort.key !== 'created_at'

  return (
    <div className="page-inner">
      <PageHeader title="담당자" description="거래처 담당자 연락처 관리" actions={
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Link href="/lead-intake?target=contact" className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius)', minHeight: '44px' }}>
            <Sparkles size={16} /> AI로 추가
          </Link>
          <Link href="/contacts/new?mode=manual" className="btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', padding: 'var(--space-2) var(--space-4)', minHeight: '44px' }}>
            <Plus size={16} /> 수동 입력
          </Link>
        </div>
      } />

      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="이름 또는 이메일 검색"
        sortOptions={SORT_OPTIONS}
        showSize={false}
        total={contacts.length}
      />

      <ListSurface
        rows={contacts}
        columns={COLUMNS}
        query={query}
        rowKey={(c) => c.id}
        onChange={set}
        loading={isLoading}
        error={error ? { message: '담당자 목록을 불러오지 못했습니다', onRetry: () => { void mutate() } } : null}
        empty={hasFilters
          ? { title: '조건에 맞는 담당자가 없어요', description: '검색어나 정렬을 바꿔보세요' }
          : { title: '아직 등록된 담당자가 없어요', description: '거래처 담당자를 등록하면 여기 모입니다', action: { label: '담당자 추가', href: '/contacts/new?mode=manual' } }}
        onRowClick={(c) => setSelected(c)}
      />

      <ListPager query={query} hasMore={last?.hasMore ?? false} onChange={set} loading={isValidating && !isLoading} />

      {last?.capped && (
        <p style={{ textAlign: 'center', padding: 'var(--space-3)', fontSize: 'var(--fs-sm)', color: 'var(--warning)' }}>
          결과가 500건을 초과합니다. 검색 조건을 좁혀주세요.
        </p>
      )}

      <SlidePanel isOpen={!!selected} onClose={() => setSelected(null)} title={selected?.name ?? ''}>
        {selected && <ContactDetail contact={selected} onClose={() => setSelected(null)} onDeleted={() => { void mutate(); setSelected(null) }} />}
      </SlidePanel>
    </div>
  )
}

function ContactDetail({ contact: c, onClose, onDeleted }: { contact: ContactWithAccount; onClose: () => void; onDeleted: () => void }) {
  async function handleDelete() {
    if (!confirm(`담당자 "${c.name}"을(를) 삭제하시겠습니까?`)) return
    const res = await fetch(`/api/contacts/${c.id}`, { method: 'DELETE' })
    if (res.ok) onDeleted()
    else alert('삭제에 실패했습니다')
  }
  return (
    <div>
      {/* 직책/부서 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '1rem' }}>
        {c.title     && <span className="badge badge-slate">{c.title}</span>}
        {c.department && <span className="badge" style={{ background: 'var(--color-bg)', color: 'var(--text-muted)' }}>{c.department}</span>}
      </div>

      <div className="detail-info-list">
        {c.accounts?.name && (
          <div className="detail-info-row">
            <Briefcase size={14} color="var(--brand)" style={{ flexShrink: 0 }} />
            <Link href={`/accounts/${c.account_id}`} onClick={onClose} style={{ color: 'var(--brand)', textDecoration: 'none', fontWeight: 500 }}>
              {c.accounts.name}
            </Link>
          </div>
        )}
        {c.email && (
          <div className="detail-info-row">
            <Mail size={14} color="var(--brand)" style={{ flexShrink: 0 }} />
            <a href={`mailto:${c.email}`} style={{ color: 'var(--brand)', textDecoration: 'none' }}>{c.email}</a>
          </div>
        )}
        {c.mobile && (
          <div className="detail-info-row">
            <Phone size={14} color="var(--brand)" style={{ flexShrink: 0 }} />
            <span>📱 {c.mobile}</span>
          </div>
        )}
        {c.phone && (
          <div className="detail-info-row">
            <Phone size={14} color="var(--brand)" style={{ flexShrink: 0 }} />
            <span>{c.phone}</span>
          </div>
        )}
        {c.notes && (
          <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text)', lineHeight: 1.6, margin: '0.5rem 0 0' }}>
            {c.notes}
          </p>
        )}
      </div>

      <div className="detail-actions">
        <Link href={`/contacts/${c.id}`} className="detail-btn-primary" onClick={onClose}>
          <ExternalLink size={14} /> 전체 보기
        </Link>
        <Link href={`/contacts/${c.id}/edit`} className="detail-btn-ghost" onClick={onClose}>
          편집
        </Link>
        <button onClick={handleDelete} className="detail-btn-ghost" style={{ color: 'var(--danger)', borderColor: 'var(--danger-border)', cursor: 'pointer' }}>
          삭제
        </button>
      </div>
    </div>
  )
}
