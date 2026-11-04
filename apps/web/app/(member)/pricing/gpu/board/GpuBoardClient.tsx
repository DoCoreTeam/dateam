'use client'

// GPU 한 장 화면 — 모델마다 gcube 판매가, 적정판매가, 그 차이, 그리고 어디가 제일 싼지
// 공급사 칸 수는 표 폭으로만 정한다 (supplierSlotCount), 공급사 전부와 일자는 줄 끝 「자세히」 창에서 본다
// 칸마다 최소 폭이 있어 표가 그보다 좁으면 표 몸통만 가로로 밀린다, 모델명 열과 단추 열은 제자리, 더 있는 쪽에 그림자
// 좁은 폭(640px 이하)에서는 표 대신 모델별 카드로 그린다, 가로 스크롤을 만들지 않는다

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'
import { fmtKRW } from '@/lib/gpu/format-price'
import { supplierSlotCount, BOARD_FIXED_WIDTH_PX, BOARD_SLOT_MIN_PX, type Board, type BoardOffer, type BoardRow } from '@/lib/gpu/board'
import { BOARD_COPY as C } from '@/lib/gpu/board-copy'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import { SkelList } from '@/components/ui/LoadingSkeleton'
import MarginControl from '@/components/pricing/gpu/MarginControl'
import GpuBoardPanel from './GpuBoardPanel'
import GcubeLinkPanel from './GcubeLinkPanel'
import EntryPanel, { type EntryPreset } from './EntryPanel'
import { useScrollEdges } from './useScrollEdges'
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

/** 값이 없는 줄 — 읽을 수 있는 원가도 판매가도 없다 (단위를 못 읽은 값만 있는 줄도 여기) */
export function isEmptyRow(row: BoardRow): boolean {
  return row.cheapest_krw == null && row.sale_krw == null
}

/** 칸 아래 작은 표기 하나: 견적이면 견적, 약정이 있으면 약정 (온디맨드 시세는 적지 않는다) */
function offerNote(o: BoardOffer): string {
  return [o.kind === 'quote' ? C.kindQuote : null, o.term === 'on_demand' ? null : o.term_label].filter(Boolean).join(' ')
}

function SlotCell({ offer }: { offer: BoardOffer | undefined }) {
  if (!offer) return <div className={`${s.slot} ${s.muted}`} role="cell">-</div>
  const note = offerNote(offer)
  return (
    <div className={s.slot} role="cell">
      <span className={s.price}>{offer.krw == null ? C.unknownUnit : fmtKRW(offer.krw)}</span>
      <span className={s.subLine} title={[offer.vendor, note].filter(Boolean).join(' ')}>
        <span className={s.vendor}>{offer.vendor}</span>
        {note && <span className={s.note}>{note}</span>}
      </span>
    </div>
  )
}

function SaleCell({ row }: { row: BoardRow }) {
  if (row.sale_krw == null) {
    return (
      <>
        <span className={`${s.price} ${s.muted}`}>-</span>
        <span className={s.sub}>{C.saleNotLinked}</span>
      </>
    )
  }
  return (
    <>
      <span className={s.priceLead}>{fmtKRW(row.sale_krw)}</span>
      <span className={s.sub}>
        {row.reflected === true ? <span className={s.ok}>{C.reflected}</span>
          : row.reflected === false && row.target_krw != null ? <span className={s.warn}>{C.notReflected(fmtKRW(row.target_krw))}</span>
          : C.saleGcube}
      </span>
    </>
  )
}

function FairCell({ row, marginPct }: { row: BoardRow; marginPct: number }) {
  return (
    <>
      {row.fair_krw == null
        ? <span className={`${s.price} ${s.muted}`}>{C.noPrice}</span>
        : <span className={s.priceLead}>{fmtKRW(row.fair_krw)}</span>}
      <span className={s.sub}>{C.fairByMargin(marginPct)}</span>
    </>
  )
}

function GapCell({ row }: { row: BoardRow }) {
  if (row.gap_krw == null) return <span className={s.muted}>-</span>
  const sign = row.gap_krw > 0 ? '+' : row.gap_krw < 0 ? '-' : ''
  return (
    <span className={`${s.price} ${row.gap_krw < 0 ? s.gapBelow : ''}`} title={C.gapTitle}>
      {sign}{fmtKRW(Math.abs(row.gap_krw))}
    </span>
  )
}

/** 줄 끝 단추 — 값이 있으면 상세 창, 없으면 그 모델이 채워진 시세 입력 */
function RowAction({ row, onOpen, onAdd }: { row: BoardRow; onOpen: () => void; onAdd: () => void }) {
  if (row.offers.length === 0) {
    return <button type="button" className={s.action} onClick={onAdd}>{C.addMarket}</button>
  }
  return (
    <button type="button" className={s.action} onClick={onOpen}>
      {row.vendors.length > 0 ? C.openAll(row.vendors.length) : C.openDetail}
    </button>
  )
}

interface RowProps {
  row: BoardRow
  slots: number
  marginPct: number
  onOpen: () => void
  onAdd: () => void
}

function BoardRowView({ row, slots, marginPct, onOpen, onAdd }: RowProps) {
  const cells = Array.from({ length: slots }, (_, i) => row.vendors[i])
  return (
    <div className={`${s.row} ${isEmptyRow(row) ? s.rowEmpty : ''}`} role="row">
      <div className={s.model} role="cell">
        <span className={s.modelName}>{row.model}</span>
        <span className={s.sub}>{memLabel(row.memory_per_gpu_gb)}</span>
      </div>
      <div className={s.num} role="cell"><SaleCell row={row} /></div>
      <div className={s.num} role="cell"><FairCell row={row} marginPct={marginPct} /></div>
      <div className={s.num} role="cell"><GapCell row={row} /></div>
      {cells.map((o, i) => <SlotCell key={o?.id ?? `empty-${i}`} offer={o} />)}
      <div className={s.actionCell} role="cell"><RowAction row={row} onOpen={onOpen} onAdd={onAdd} /></div>
    </div>
  )
}

function BoardTable({ rows, slots, marginPct, onOpen, onAdd }: {
  rows: BoardRow[]; slots: number; marginPct: number; onOpen: (key: string) => void; onAdd: (row: BoardRow) => void
}) {
  const { headRef, bodyRef, edges } = useScrollEdges()
  const rowMin = { '--row-min': `${BOARD_FIXED_WIDTH_PX + slots * BOARD_SLOT_MIN_PX}px` } as CSSProperties
  return (
    <div role="table" aria-label={C.title} className={s.table} style={rowMin}
      data-more-left={edges.moreLeft || undefined} data-more-right={edges.moreRight || undefined}>
      <div ref={headRef} className={s.headScroll} role="rowgroup">
        <div className={`${s.row} ${s.head}`} role="row">
          <div role="columnheader">{C.colModel}</div>
          <div role="columnheader" className={s.num}>{C.colSale}</div>
          <div role="columnheader" className={s.num}>{C.colFair}</div>
          <div role="columnheader" className={s.num}>{C.colGap}</div>
          {Array.from({ length: slots }, (_, i) => <div key={i} role="columnheader" className={s.slotHead}>{C.colVendor(i + 1)}</div>)}
          <div role="columnheader" aria-hidden />
        </div>
      </div>
      <div ref={bodyRef} className={s.bodyScroll} role="rowgroup">
        {rows.map((row) => (
          <BoardRowView key={row.key} row={row} slots={slots} marginPct={marginPct}
            onOpen={() => onOpen(row.key)} onAdd={() => onAdd(row)} />
        ))}
      </div>
    </div>
  )
}

/** 좁은 폭 카드 — 모델명, 가장 싼 값과 그 공급사, 판매가, 단추 하나 */
function BoardCards({ rows, onOpen, onAdd }: {
  rows: BoardRow[]; onOpen: (key: string) => void; onAdd: (row: BoardRow) => void
}) {
  return (
    <ul className={s.cards} aria-label={C.title}>
      {rows.map((row) => {
        const lowest = row.vendors[0]
        return (
          <li key={row.key} className={`${s.card} ${isEmptyRow(row) ? s.rowEmpty : ''}`}>
            <div className={s.cardHead}>
              <span className={s.modelName}>{row.model}</span>
              <span className={s.sub}>{memLabel(row.memory_per_gpu_gb)}</span>
            </div>
            <dl className={s.cardFacts}>
              <div>
                <dt>{C.lowest}</dt>
                <dd>
                  <span className={s.priceLead}>{lowest?.krw != null ? fmtKRW(lowest.krw) : '-'}</span>
                  {lowest && <span className={s.sub}>{lowest.vendor}</span>}
                </dd>
              </div>
              <div>
                <dt>{C.colSale}</dt>
                <dd><SaleCell row={row} /></dd>
              </div>
            </dl>
            <RowAction row={row} onOpen={() => onOpen(row.key)} onAdd={() => onAdd(row)} />
          </li>
        )
      })}
    </ul>
  )
}

/** 시세 추가 — 장수가 가장 적은 상품을 그 모델 칸에 미리 넣는다 */
function presetOf(row: BoardRow): EntryPreset | undefined {
  const product = [...row.products].sort((a, b) => a.gpu_count - b.gpu_count)[0]
  return product ? { kind: 'market', product_id: product.id } : undefined
}

export default function GpuBoardClient({ isAdmin }: { isAdmin: boolean }) {
  const { data, error, isLoading, mutate } = useSWR<Board>(BOARD_API, fetcher)
  const { ref, slots } = useSlotCount()
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [gcubeOpen, setGcubeOpen] = useState(false)
  const [entry, setEntry] = useState<{ preset?: EntryPreset } | null>(null)
  const [showAll, setShowAll] = useState(false)
  const openRow = data?.rows.find((r) => r.key === openKey) ?? null
  const emptyCount = data?.rows.filter(isEmptyRow).length ?? 0
  const rows = (data?.rows ?? []).filter((r) => showAll || !isEmptyRow(r))
  const onAdd = (row: BoardRow) => setEntry({ preset: presetOf(row) })

  return (
    <div className={`page-inner ${s.board}`}>
      <PageHeader className="page-header--compact" eyebrow={C.eyebrow} title={C.title} description={C.description} descClassName={s.keep} />
      <p className={s.steps}>
        <span className={s.stepsLabel}>{C.stepsLabel}</span>
        {C.steps.map((step, i) => (
          <span key={step}>{i > 0 && <span className={s.stepArrow} aria-hidden>›</span>}{step}</span>
        ))}
      </p>
      <div className={s.toolbar}>
        <button type="button" className="btn-primary" onClick={() => setEntry({})}>{C.entryOpen}</button>
        <button type="button" className="btn-ghost" onClick={() => setGcubeOpen(true)}>{C.gcubeOpen}</button>
        {data && <MarginControl marginPct={data.margin_pct} isAdmin={isAdmin} onSaved={() => void mutate()} />}
        <Link href={MANAGE_HREF} className={s.manageLink}>{C.manageLink}</Link>
      </div>
      {data && <p className={s.basis}>{C.basis(fmtKRW(data.usd_krw), data.fx_date)}</p>}
      {data && data.rows.length > 0 && (
        <div className={s.readHow}>
          <p>{C.readHow(slots)}</p>
          {emptyCount > 0 && (
            <button type="button" className="btn-ghost" aria-pressed={showAll} onClick={() => setShowAll((v) => !v)}>
              {showAll ? C.showValued : C.showAll(emptyCount)}
            </button>
          )}
        </div>
      )}
      <div ref={ref} className={s.wrap} style={{ '--slots': slots } as CSSProperties}>
        {error ? (
          <ErrorState message={C.loadFailed} onRetry={() => void mutate()} />
        ) : isLoading || !data ? (
          <SkelList rows={8} />
        ) : data.rows.length === 0 ? (
          <EmptyState title={C.emptyTitle} description={C.emptyDesc} action={{ label: C.manageLink, href: MANAGE_HREF }} />
        ) : (
          <>
            <BoardTable rows={rows} slots={slots} marginPct={data.margin_pct} onOpen={setOpenKey} onAdd={onAdd} />
            <BoardCards rows={rows} onOpen={setOpenKey} onAdd={onAdd} />
          </>
        )}
      </div>
      {entry && (
        <EntryPanel board={data} isAdmin={isAdmin} preset={entry.preset} onClose={() => setEntry(null)} onSaved={() => void mutate()} />
      )}
      {gcubeOpen && (
        <GcubeLinkPanel board={data} isAdmin={isAdmin} onClose={() => setGcubeOpen(false)} onChanged={() => void mutate()} />
      )}
      {openRow && (
        <GpuBoardPanel row={openRow} marginPct={data?.margin_pct ?? 0} isAdmin={isAdmin}
          onClose={() => setOpenKey(null)} onSaved={() => void mutate()} />
      )}
    </div>
  )
}
