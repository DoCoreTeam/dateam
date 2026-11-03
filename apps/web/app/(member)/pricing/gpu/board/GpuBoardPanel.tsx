'use client'

// 모델 한 줄의 공급사 전부 — 싼 순, 단위 모름은 맨 아래 (순서는 lib/gpu/board.ts 가 정함)

import { fmtKRW } from '@/lib/gpu/format-price'
import type { BoardOffer, BoardRow } from '@/lib/gpu/board'
import { BOARD_COPY as C } from '@/lib/gpu/board-copy'
import SlidePanel from '@/components/ui/SlidePanel'
import ListSurface from '@/components/ui/list/ListSurface'
import type { ColumnDef } from '@/components/ui/list/types'
import { resolveListQuery } from '@/lib/ui/list-query'
import StrategicEditor from './StrategicEditor'
import s from './board.module.css'

const PANEL_WIDTH_PX = 720

function originalText(o: BoardOffer): string {
  if (o.original_amount == null) return '-'
  const amount = o.original_amount.toLocaleString('ko-KR', { maximumFractionDigits: 4 })
  // 단위가 통화를 이미 담으면(USD/hr) 통화를 또 적지 않는다
  const unitHasCurrency = !!o.original_currency && !!o.original_unit?.includes(o.original_currency)
  return [amount, unitHasCurrency ? null : o.original_currency, o.original_unit].filter(Boolean).join(' ')
}

// 순서는 board.ts 가 이미 정했다 — 정렬 없는 고정 목록이라 URL 상태를 만들지 않고 표 렌더러만 쓴다
const OFFER_QUERY = resolveListQuery(new URLSearchParams(), { sort: { key: 'rank', dir: 'asc' }, view: 'table' })

const OFFER_COLUMNS: ColumnDef<BoardOffer>[] = [
  { key: 'vendor', header: C.thVendor, primary: true, cell: (o) => <span className={s.pVendor}>{o.vendor}</span> },
  {
    key: 'krw', header: C.thKrw, align: 'right',
    cell: (o) => o.krw == null ? <span className={s.slotEmpty}>{C.unknownUnit}</span> : <span className={s.pNum}>{fmtKRW(o.krw)}</span>,
  },
  { key: 'original', header: C.thOriginal, align: 'right', cell: (o) => <span className={s.pNum}>{originalText(o)}</span> },
  { key: 'term', header: C.thTerm, cell: (o) => o.term_label || '-' },
  { key: 'kind', header: C.thKind, cell: (o) => (o.kind === 'quote' ? C.kindQuote : C.kindMarket) },
  { key: 'date', header: C.thDate, cell: (o) => <span className={s.pNum}>{o.date?.slice(0, 10) ?? '-'}</span> },
  {
    key: 'source', header: C.thSource,
    cell: (o) => o.source_url
      ? <a href={o.source_url} target="_blank" rel="noopener noreferrer" className={s.basisLink}>{C.sourceLink}</a>
      : '-',
  },
]

export function OfferTable({ offers }: { offers: BoardOffer[] }) {
  return (
    <ListSurface
      rows={offers}
      columns={OFFER_COLUMNS}
      query={OFFER_QUERY}
      rowKey={(o) => o.id}
      empty={{ title: C.offersEmpty }}
    />
  )
}

export default function GpuBoardPanel({ row, marginPct, isAdmin, onClose, onSaved }: {
  row: BoardRow; marginPct: number; isAdmin: boolean; onClose: () => void; onSaved: () => void
}) {
  const mem = row.memory_per_gpu_gb == null ? '' : ` ${row.memory_per_gpu_gb}GB`
  return (
    <SlidePanel isOpen onClose={onClose} title={`${row.model}${mem}`} width={PANEL_WIDTH_PX}>
      <StrategicEditor key={`${row.key}:${row.sell_basis}:${row.sell_krw}`} row={row} marginPct={marginPct} isAdmin={isAdmin} onSaved={onSaved} />
      <h3 className={s.pHeading}>{C.panelOffers(row.offers.length)}</h3>
      <OfferTable offers={row.offers} />
    </SlidePanel>
  )
}
