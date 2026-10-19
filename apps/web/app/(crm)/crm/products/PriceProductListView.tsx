'use client'

// 가격 기준 > 제품 목록
//
// 행을 누르면 상세(품목, 규칙, 할인, 미리 계산, 변경 이력)로 간다.
// 지우기는 휴지통이다. 품목은 지난 견적이 가리키므로 제품을 지워도 남는다 — 확인창이 그 영향을 말한다.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Trash2, Upload } from 'lucide-react'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import type { ColumnDef } from '@/components/ui/list/types'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import NbModal from '@/components/ui/nb/NbModal'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { TRASH_FILTER, TRASH_FILTER_KEYS, TRASH_EMPTY, isTrashView, useRestore, restoreColumn } from '@/components/ui/crm/trash'
import { ACTION, PRICEBOOK, BUSINESS_TYPE_LABEL, progress } from '@/lib/terms'
import { useListQuery } from '@/lib/ui/use-list-query'
import { kstDateKey } from '@/lib/datetime/kst'
import PriceProductCreateModal from './PriceProductCreateModal'
import PricebookImportModal from './PricebookImportModal'
import styles from './pricebook.module.css'

export interface PriceProductRow {
  id: string
  name: string
  businessTypeKey: string
  itemCount: number
  ruleCount: number
  updatedAt: string
  isActive: boolean
  needsReview: boolean
}

const ENDPOINT = '/api/crm/pricebook/products'

function typeLabel(key: string): string {
  return (BUSINESS_TYPE_LABEL as Record<string, string>)[key] ?? key
}

export default function PriceProductListView() {
  const router = useRouter()
  const { query, set, queryKey } = useListQuery({
    view: 'table', size: 50, sort: { key: 'name', dir: 'asc' }, mode: 'more',
    filterKeys: [...TRASH_FILTER_KEYS],
  })
  const [rows, setRows] = useState<PriceProductRow[]>([])
  const [unsorted, setUnsorted] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [deleting, setDeleting] = useState<PriceProductRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const trash = isTrashView(query)
  const q = query.q ?? ''

  const load = useCallback(async () => {
    void queryKey
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams()
      if (q) sp.set('q', q)
      if (trash) sp.set('trash', '1')
      const res = await fetch(`${ENDPOINT}?${sp.toString()}`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '제품을 불러오지 못했습니다.'); return }
      setRows(body.items ?? [])
      setUnsorted(Number(body.unsorted ?? 0))
    } catch {
      setError('제품을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [queryKey, q, trash])

  useEffect(() => { void load() }, [load])
  const { restore, restoreError } = useRestore(ENDPOINT, () => void load())

  const remove = useCallback(async () => {
    if (!deleting) return
    setBusy(true)
    setActionError(null)
    try {
      const res = await fetch(`${ENDPOINT}/${deleting.id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => null)
      if (!res.ok) { setActionError(body?.error?.message ?? '삭제하지 못했습니다.'); return }
      setDeleting(null)
      await load()
    } catch {
      setActionError('삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }, [deleting, load])

  const columns = useMemo<ColumnDef<PriceProductRow>[]>(() => {
    const base: ColumnDef<PriceProductRow>[] = [
      {
        key: 'name', header: PRICEBOOK.tabProduct, primary: true,
        cell: (r) => (
          <>
            <b>{r.name}</b>
            {r.needsReview && <span style={{ marginLeft: 'var(--space-2)' }}><NbBadge status="note">{PRICEBOOK.needsReview}</NbBadge></span>}
          </>
        ),
      },
      { key: 'type', header: PRICEBOOK.businessType, cell: (r) => typeLabel(r.businessTypeKey) },
      { key: 'items', header: PRICEBOOK.itemCount, cell: (r) => r.itemCount },
      { key: 'rules', header: PRICEBOOK.ruleCount, cell: (r) => r.ruleCount },
      { key: 'updated', header: PRICEBOOK.updatedAt, hideOnCard: true, cell: (r) => kstDateKey(r.updatedAt) },
      {
        key: 'status', header: PRICEBOOK.status,
        cell: (r) => <NbBadge status={r.isActive ? 'done' : 'note'}>{r.isActive ? PRICEBOOK.onSale : PRICEBOOK.stopped}</NbBadge>,
      },
    ]
    if (trash) return [...base, restoreColumn<PriceProductRow>((id) => void restore(id))]
    return [...base, {
      key: 'actions', header: '', noLabel: true,
      cell: (r) => (
        <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
          <NbButton variant="ghost" onClick={() => setDeleting(r)}><Trash2 size={14} /> {ACTION.delete}</NbButton>
        </div>
      ),
    }]
  }, [trash, restore])

  return (
    <>
      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder={PRICEBOOK.searchProduct}
        views={['table', 'card']}
        filters={[TRASH_FILTER]}
        actions={(
          <>
            <NbButton variant="ghost" onClick={() => setImporting(true)}><Upload size={14} /> {PRICEBOOK.importFile}</NbButton>
            <NbButton onClick={() => setCreating(true)}><Plus size={14} /> {PRICEBOOK.newProduct}</NbButton>
          </>
        )}
      />
      {(actionError || restoreError) && <p role="alert" className={styles.alert}>{actionError ?? restoreError}</p>}
      <ListSurface
        rows={rows}
        columns={columns}
        query={query}
        onChange={set}
        rowKey={(r) => r.id}
        onRowClick={trash ? undefined : (r) => router.push(`/crm/products/${r.id}`)}
        loading={loading && rows.length === 0}
        error={error ? { message: error, onRetry: () => void load() } : null}
        empty={trash ? TRASH_EMPTY : {
          title: q ? '조건에 맞는 제품이 없어요' : '제품이 아직 없어요',
          description: q ? '검색어를 바꿔 보세요.' : '가격표 파일을 올리거나 새 제품을 만들어 품목과 규칙을 넣으세요.',
          action: q ? undefined : { label: PRICEBOOK.newProduct, onClick: () => setCreating(true) },
        }}
      />
      {!trash && unsorted > 0 && (
        <div className={styles.unsorted}>
          <span>{PRICEBOOK.autoRegistered} <b>{unsorted}개</b> · {PRICEBOOK.noProduct} · {PRICEBOOK.unsorted}</span>
          <Link href="/crm/products?tab=item&auto=1">{PRICEBOOK.tabItem}</Link>
        </div>
      )}
      {importing && (
        <PricebookImportModal
          target="product"
          onClose={() => setImporting(false)}
          onSaved={(id) => { setImporting(false); if (id) router.push(`/crm/products/${id}`); else void load() }}
        />
      )}
      {creating && (
        <PriceProductCreateModal
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); router.push(`/crm/products/${id}`) }}
        />
      )}
      {deleting && (
        <NbModal
          title={`「${deleting.name}」 제품을 삭제할까요?`}
          onClose={() => setDeleting(null)}
          maxWidth={480}
          footer={(
            <div className={styles.foot}>
              <NbButton variant="ghost" onClick={() => setDeleting(null)} disabled={busy}>{ACTION.cancel}</NbButton>
              <NbButton variant="danger" onClick={() => void remove()} disabled={busy}>
                {busy ? progress(ACTION.delete) : ACTION.delete}
              </NbButton>
            </div>
          )}
        >
          <FormErrorBanner message={actionError} />
          <p>휴지통으로 옮겨요. 30일 안에 되살릴 수 있어요.</p>
          <p className={styles.faint}>
            품목 {deleting.itemCount}개와 지난 견적은 그대로 남아요. 규칙 {deleting.ruleCount}개는 이 제품과 함께 휴지통에 있어요.
          </p>
        </NbModal>
      )}
    </>
  )
}
