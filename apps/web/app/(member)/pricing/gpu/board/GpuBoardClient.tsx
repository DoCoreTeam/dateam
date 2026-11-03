'use client'

// GPU 한 장 화면 — 모델마다 어디가 제일 싸고 그래서 얼마에 팔면 되는지
// 공급사 칸 수는 표 폭으로만 정한다 (supplierSlotCount), 공급사 전부는 줄 끝 단추의 창에서 본다

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'
import { fmtKRW } from '@/lib/gpu/format-price'
import { supplierSlotCount, type Board, type BoardOffer, type BoardRow } from '@/lib/gpu/board'
import { BOARD_COPY as C } from '@/lib/gpu/board-copy'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import { SkelList } from '@/components/ui/LoadingSkeleton'
import GpuBoardPanel from './GpuBoardPanel'
import s from './board.module.css'

export const BOARD_API = '/api/pricing/gpu/board'
const MANAGE_HREF = '/pricing/gpu/manage'

/** 표 폭을 재서 공급사 칸 수를 낸다. 첫 렌더는 1칸 (서버와 같게) */
function useSlotCount() {
  const ref = useRef<HTMLDivElement>(null)
  const [slots, setSlots] = useState(1)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSlots(supplierSlotCount(el.clientWidth))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, slots }
}

function memLabel(gb: number | null): string {
  return gb == null ? '' : `${gb}GB`
}

function SlotCell({ offer }: { offer: BoardOffer | undefined }) {
  if (!offer) return <div className={`${s.slot} ${s.slotEmpty}`} aria-hidden>-</div>
  return (
    <div className={s.slot}>
      <span className={s.slotPrice}>{fmtKRW(offer.krw)}</span>
      <span className={`${s.tag} ${offer.kind === 'quote' ? s.tagQuote : ''}`}>
        {offer.kind === 'quote' ? C.kindQuote : C.kindMarket}
      </span>
      {offer.term_label && <span className={s.tag}>{offer.term_label}</span>}
      <span className={s.slotVendor} title={offer.vendor}>{offer.vendor}</span>
    </div>
  )
}

function SellCell({ row, marginPct }: { row: BoardRow; marginPct: number }) {
  if (row.sell_krw == null) return <span className={s.slotEmpty}>{C.noPrice}</span>
  return (
    <>
      {fmtKRW(row.sell_krw)}
      <span className={s.sellBasis}>
        {row.sell_basis === 'strategic' ? C.sellByStrategic : C.sellByMargin(marginPct)}
      </span>
    </>
  )
}

function BoardRowView({ row, slots, marginPct, onOpen }: {
  row: BoardRow; slots: number; marginPct: number; onOpen: () => void
}) {
  const cells = Array.from({ length: slots }, (_, i) => row.vendors[i])
  return (
    <div className={s.row} role="row">
      <div className={s.model} role="cell">
        <div className={s.modelName}>{row.model}</div>
        <div className={s.modelMem}>{memLabel(row.memory_per_gpu_gb)}</div>
        <div className={`${s.sell} ${s.mobileSell}`}><SellCell row={row} marginPct={marginPct} /></div>
      </div>
      <div className={s.sell} role="cell"><SellCell row={row} marginPct={marginPct} /></div>
      {cells.map((o, i) => <SlotCell key={o?.id ?? `empty-${i}`} offer={o} />)}
      <div className={s.date} role="cell">{row.latest_date?.slice(0, 10) ?? '-'}</div>
      <button type="button" className={s.open} onClick={onOpen}>
        {row.offers.length > 0 ? C.openAll(row.vendors.length) : C.openEmpty}
      </button>
    </div>
  )
}

function BoardTable({ board, slots, onOpen }: { board: Board; slots: number; onOpen: (key: string) => void }) {
  return (
    <div role="table" aria-label={C.title}>
      <div className={`${s.row} ${s.head}`} role="row">
        <div role="columnheader">{C.colModel}</div>
        <div className={s.headSell} role="columnheader">{C.colSell}</div>
        {Array.from({ length: slots }, (_, i) => <div key={i} role="columnheader">{C.colVendor(i + 1)}</div>)}
        <div className={s.headDate} role="columnheader">{C.colLatest}</div>
        <div role="columnheader" aria-hidden />
      </div>
      {board.rows.map((row) => (
        <BoardRowView key={row.key} row={row} slots={slots} marginPct={board.margin_pct} onOpen={() => onOpen(row.key)} />
      ))}
    </div>
  )
}

export default function GpuBoardClient({ isAdmin: _isAdmin }: { isAdmin: boolean }) {
  const { data, error, isLoading, mutate } = useSWR<Board>(BOARD_API, fetcher)
  const { ref, slots } = useSlotCount()
  const [openKey, setOpenKey] = useState<string | null>(null)
  const openRow = data?.rows.find((r) => r.key === openKey) ?? null

  return (
    <div className="page-inner">
      <PageHeader className="page-header--compact" eyebrow={C.eyebrow} title={C.title} />
      <div className={s.basis}>
        {data && <span>{C.basis(fmtKRW(data.usd_krw), data.fx_date)}</span>}
        <Link href={MANAGE_HREF} className={s.basisLink}>{C.manageLink}</Link>
      </div>
      <div ref={ref} className={s.wrap} style={{ '--slots': slots } as CSSProperties}>
        {error ? (
          <ErrorState message={C.loadFailed} onRetry={() => void mutate()} />
        ) : isLoading || !data ? (
          <SkelList rows={8} />
        ) : data.rows.length === 0 ? (
          <EmptyState title={C.emptyTitle} description={C.emptyDesc} action={{ label: C.manageLink, href: MANAGE_HREF }} />
        ) : (
          <BoardTable board={data} slots={slots} onOpen={setOpenKey} />
        )}
      </div>
      {openRow && (
        <GpuBoardPanel row={openRow} onClose={() => setOpenKey(null)} />
      )}
    </div>
  )
}
