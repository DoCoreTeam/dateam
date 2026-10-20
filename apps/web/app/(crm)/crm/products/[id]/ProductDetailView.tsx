'use client'

// 제품 상세 — 기본 정보, 품목, 규칙, 할인, 미리 계산, 변경 이력
//
// 한 번 읽어 탭이 나눠 쓴다. 고치면 다시 읽는다 — 버전 잠금이 있어 옛 값으로 다시 저장하면 거절된다.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Upload } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbModal from '@/components/ui/nb/NbModal'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import AXDotLoader from '@/components/ui/AXDotLoader'
import ErrorState from '@/components/ui/ErrorState'
import NbBadge from '@/components/ui/nb/NbBadge'
import { ACTION, PRICEBOOK, progress } from '@/lib/terms'
import type { DetailJson } from './detail-shape'
import InfoTab from './InfoTab'
import ItemsTab from './ItemsTab'
import RulesTab from './RulesTab'
import PreviewTab from './PreviewTab'
import HistoryTab from './HistoryTab'
import PricebookImportModal from '../PricebookImportModal'
import styles from './detail.module.css'

export default function ProductDetailView({ id }: { id: string }) {
  const [data, setData] = useState<DetailJson | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const router = useRouter()

  /** 휴지통으로 — 품목과 지난 견적은 남는다. 30일 안에 목록의 휴지통에서 되살린다 */
  const remove = async () => {
    setBusy(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/crm/pricebook/products/${id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => null)
      if (!res.ok) { setDeleteError(body?.error?.message ?? '삭제하지 못했습니다.'); return }
      router.push('/crm/products?tab=product')
    } catch {
      setDeleteError('삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/crm/pricebook/products/${id}`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '제품을 불러오지 못했습니다.'); return }
      setData(body)
    } catch {
      setError('제품을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  if (error) return <ErrorState message={error} onRetry={() => void load()} />
  if (!data) return <AXDotLoader />

  const reload = () => void load()
  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h2 className={styles.title}>
          {data.product.name}{' '}
          {!data.product.isActive && <NbBadge status="note">{PRICEBOOK.stopped}</NbBadge>}
        </h2>
        <div className={styles.actions}>
          <NbButton variant="ghost" onClick={() => setImporting(true)}><Upload size={14} /> {PRICEBOOK.importFile}</NbButton>
          <NbButton variant="danger-ghost" onClick={() => setDeleting(true)}><Trash2 size={14} /> {ACTION.delete}</NbButton>
        </div>
      </div>
      {importing && (
        <PricebookImportModal target="product" productId={id} onClose={() => setImporting(false)} onSaved={() => { setImporting(false); void load() }} />
      )}
      {deleting && (
        <NbModal
          title={`「${data.product.name}」 제품을 삭제할까요?`}
          onClose={() => setDeleting(false)}
          maxWidth={480}
          footer={(
            <div className={styles.foot}>
              <NbButton variant="ghost" onClick={() => setDeleting(false)} disabled={busy}>{ACTION.cancel}</NbButton>
              <NbButton variant="danger" onClick={() => void remove()} disabled={busy}>{busy ? progress(ACTION.delete) : ACTION.delete}</NbButton>
            </div>
          )}
        >
          <FormErrorBanner message={deleteError} />
          <p>휴지통으로 옮겨요. 30일 안에 제품 목록의 휴지통에서 되살릴 수 있어요.</p>
          <p className={styles.faint}>품목 {data.items.length}개와 지난 견적은 그대로 남아요.</p>
        </NbModal>
      )}
      <SegmentedTabs
        ariaLabel={data.product.name}
        param="view"
        tabs={[
          { id: 'info', label: PRICEBOOK.detailInfo, content: <InfoTab data={data} onSaved={reload} /> },
          { id: 'items', label: PRICEBOOK.detailItems, badge: data.items.filter((i) => i.isActive).length, content: <ItemsTab data={data} onSaved={reload} /> },
          { id: 'rules', label: PRICEBOOK.detailRules, content: <RulesTab data={data} mode="rules" onSaved={reload} /> },
          { id: 'discounts', label: PRICEBOOK.detailDiscounts, content: <RulesTab data={data} mode="discounts" onSaved={reload} /> },
          { id: 'preview', label: PRICEBOOK.detailPreview, content: <PreviewTab data={data} onSaved={reload} /> },
          { id: 'history', label: PRICEBOOK.detailHistory, content: <HistoryTab productId={data.product.id} /> },
        ]}
      />
    </div>
  )
}
