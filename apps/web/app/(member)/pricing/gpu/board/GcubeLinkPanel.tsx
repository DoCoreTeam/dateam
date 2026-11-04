'use client'

// gcube 사이트 상품(ser)과 우리 모델을 잇는 창 — 가져오기, 제안대로 잇기, 골라 잇기, 풀기
// 쓰기는 관리자 창구만 부른다 (gcube/fetch, gcube/link), 서버도 requireAdminApi 로 막는다
// 단추를 감추는 것은 보조일 뿐이다, 일반 회원은 목록만 본다

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'
import { fmtKRW } from '@/lib/gpu/format-price'
import type { Board } from '@/lib/gpu/board'
import type { GcubeFetchResult, GcubeListingRow } from '@/lib/gpu/gcube-store'
import { BOARD_COPY as C } from '@/lib/gpu/board-copy'
import SlidePanel from '@/components/ui/SlidePanel'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import WaitProgress from '@/components/ui/WaitProgress'
import { SkelList } from '@/components/ui/LoadingSkeleton'
import RecordPickerField, { type RecordOption, type RecordSearch } from '@/components/ui/RecordPicker'
import s from './board.module.css'

export const GCUBE_API = '/api/pricing/gpu/gcube'
const FETCH_API = '/api/pricing/gpu/gcube/fetch'
const LINK_API = '/api/pricing/gpu/gcube/link'
const PANEL_WIDTH_PX = 860

interface ProductOption { id: string; label: string }

/** 모델이 늘어나는 목록이라 드롭다운 대신 찾아 고르는 창을 쓴다, 검색은 화면에 이미 있는 목록에서 */
function searchOf(options: ProductOption[]): RecordSearch {
  return async (query) => {
    const q = query.toLowerCase().replace(/\s+/g, '')
    return options
      .filter((o) => !q || o.label.toLowerCase().replace(/\s+/g, '').includes(q))
      .map((o): RecordOption => ({ id: o.id, name: o.label }))
  }
}
type Link = { ser: number; product_id: string | null }

function productOptions(board: Board | undefined): ProductOption[] {
  if (!board) return []
  return board.rows.flatMap((r) => r.products.map((p) => ({
    id: p.id,
    label: `${r.model}${r.memory_per_gpu_gb == null ? '' : ` ${r.memory_per_gpu_gb}GB`} × ${p.gpu_count}`,
  }))).sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }))
}

/** 제안 먼저, 그다음 안 이은 것, 이은 것은 뒤로 */
function rank(l: GcubeListingRow): number {
  if (l.product_id) return 2
  return l.suggested_product_id ? 0 : 1
}

async function saveLinks(links: Link[]): Promise<boolean> {
  const res = await fetch(LINK_API, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ links }),
  })
  return res.ok
}

function ListingRow({ l, search, labelOf, isAdmin, busy, onLink }: {
  l: GcubeListingRow; search: RecordSearch; labelOf: Map<string, string>; isAdmin: boolean; busy: boolean
  onLink: (links: Link[]) => void
}) {
  const linked = l.product_id ? labelOf.get(l.product_id) ?? l.product_id : null
  const suggested = l.suggested_product_id ? labelOf.get(l.suggested_product_id) ?? null : null
  return (
    <div className={s.gRow} role="row">
      <div role="cell" className={s.model}>
        <div className={s.modelName}>{l.gpu_name} × {l.gpu_count}</div>
        <div className={s.modelMem}>
          {[l.vram_gb != null ? `${l.vram_gb}GB` : null, `#${l.ser}`, l.listed ? null : C.gcubeUnlisted].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div role="cell" className={s.date}>{l.product_code ?? '-'}</div>
      <div role="cell" className={s.pNum}>{fmtKRW(l.base_krw)}</div>
      <div role="cell" className={`${s.pNum} ${s.sell}`}>{fmtKRW(l.max_krw)}</div>
      <div role="cell" className={s.gLink}>
        {linked ? (
          <>
            <span className={s.tag}>{C.gcubeLinked}</span> <span>{linked}</span>
            {isAdmin && (
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => onLink([{ ser: l.ser, product_id: null }])}>
                {C.gcubeUnlink}
              </button>
            )}
          </>
        ) : suggested && isAdmin ? (
          <>
            <span className={`${s.tag} ${s.tagQuote}`}>{C.gcubeSuggested}</span> <span>{suggested}</span>
            <button type="button" className="btn-primary" disabled={busy}
              onClick={() => onLink([{ ser: l.ser, product_id: l.suggested_product_id }])}>
              {C.gcubeLink}
            </button>
          </>
        ) : isAdmin ? (
          <RecordPickerField noun={C.thGcubeLink} value="" placeholder={C.gcubePick} disabled={busy}
            search={search} initialQuery={l.gpu_name}
            onChange={(opt) => opt && onLink([{ ser: l.ser, product_id: opt.id }])} />
        ) : (
          <span className={s.slotEmpty}>-</span>
        )}
      </div>
    </div>
  )
}

export default function GcubeLinkPanel({ board, isAdmin, onClose, onChanged }: {
  board: Board | undefined; isAdmin: boolean; onClose: () => void; onChanged: () => void
}) {
  const { data, error, isLoading, mutate } = useSWR<{ listings: GcubeListingRow[] }>(GCUBE_API, fetcher)
  const [busy, setBusy] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const options = useMemo(() => productOptions(board), [board])
  const labelOf = useMemo(() => new Map(options.map((o) => [o.id, o.label])), [options])
  const search = useMemo(() => searchOf(options), [options])
  const listings = useMemo(() => [...(data?.listings ?? [])].sort((a, b) => rank(a) - rank(b)), [data])
  const suggestions = listings.filter((l) => !l.product_id && l.suggested_product_id)

  const refresh = async () => {
    await mutate()
    onChanged()
  }

  const link = async (links: Link[]) => {
    setBusy(true)
    setFailed(null)
    try {
      if (await saveLinks(links)) await refresh()
      else setFailed(C.gcubeSaveFailed)
    } catch {
      setFailed(C.gcubeSaveFailed)
    } finally {
      setBusy(false)
    }
  }

  const fetchSite = async () => {
    setFetching(true)
    setFailed(null)
    setNotice(null)
    try {
      const res = await fetch(FETCH_API, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setFailed(typeof body?.error === 'string' ? body.error : C.gcubeFetchFailed)
        return
      }
      setNotice(C.gcubeFetched(body as GcubeFetchResult))
      await refresh()
    } catch {
      setFailed(C.gcubeFetchFailed)
    } finally {
      setFetching(false)
    }
  }

  return (
    <SlidePanel isOpen onClose={onClose} title={C.gcubeTitle} width={PANEL_WIDTH_PX}>
      <p className={s.pHint}>{C.gcubeHint}</p>
      {isAdmin && (
        <div className={`${s.pActions} ${s.gActions}`}>
          <button type="button" className="btn-primary" disabled={fetching || busy} onClick={() => void fetchSite()}>
            {C.gcubeFetch}
          </button>
          {suggestions.length > 0 && (
            <button type="button" className="btn-ghost" disabled={fetching || busy}
              onClick={() => void link(suggestions.map((l) => ({ ser: l.ser, product_id: l.suggested_product_id })))}>
              {C.gcubeLinkAll(suggestions.length)}
            </button>
          )}
        </div>
      )}
      {fetching && <WaitProgress message={C.gcubeFetching} />}
      {notice && <p role="status" className={s.pSellLine}>{notice}</p>}
      {failed && <p role="alert" className={s.pError}>{failed}</p>}
      {error ? (
        <ErrorState message={C.loadFailed} onRetry={() => void mutate()} />
      ) : isLoading || !data ? (
        <SkelList rows={6} />
      ) : listings.length === 0 ? (
        <EmptyState title={C.gcubeEmpty} description={isAdmin ? C.gcubeEmptyAdmin : undefined} />
      ) : (
        <div role="table" aria-label={C.gcubeTitle} className={s.gTable}>
          <div className={`${s.gRow} ${s.head}`} role="row">
            <div role="columnheader">{C.thGcubeProduct}</div>
            <div role="columnheader">{C.thGcubeTier}</div>
            <div role="columnheader">{C.thGcubeBase}</div>
            <div role="columnheader">{C.thGcubeMax}</div>
            <div role="columnheader">{C.thGcubeLink}</div>
          </div>
          {listings.map((l) => (
            <ListingRow key={l.ser} l={l} search={search} labelOf={labelOf} isAdmin={isAdmin} busy={busy || fetching} onLink={(x) => void link(x)} />
          ))}
        </div>
      )}
    </SlidePanel>
  )
}
