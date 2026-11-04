'use client'

// 상세 창의 판매가와 적정판매가 계산, 목표 판매가 넣기 지우기
// 쓰기는 기존 관리자 창구만 부른다: 넣기 POST strategic-price/bulk, 지우기 PATCH strategic-price (null)
// 서버도 requireAdminApi 로 막는다, 단추를 감추는 것은 보조일 뿐이다

import { useState } from 'react'
import { fmtKRW } from '@/lib/gpu/format-price'
import { strategicItemsFor, type BoardRow } from '@/lib/gpu/board'
import { BOARD_COPY as C } from '@/lib/gpu/board-copy'
import MoneyField from '@/components/ui/MoneyField'
import s from './board.module.css'

const BULK_API = '/api/pricing/gpu/strategic-price/bulk'
const ONE_API = '/api/pricing/gpu/strategic-price'

function fairLine(row: BoardRow, marginPct: number): string {
  if (row.fair_krw == null) return C.panelFairNone
  return C.panelFairMargin(fmtKRW(row.cheapest_krw), marginPct, fmtKRW(row.fair_krw))
}

async function saveStrategic(row: BoardRow, perGpuKrw: number): Promise<boolean> {
  const res = await fetch(BULK_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: strategicItemsFor(row, perGpuKrw) }),
  })
  return res.ok
}

async function clearStrategic(row: BoardRow): Promise<boolean> {
  const targets = row.products.filter((p) => p.strategic_price_krw != null)
  const results = await Promise.all(targets.map((p) => fetch(ONE_API, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product_id: p.id, strategic_price_krw: null }),
  })))
  return results.every((r) => r.ok)
}

export default function StrategicEditor({ row, marginPct, isAdmin, onSaved }: {
  row: BoardRow; marginPct: number; isAdmin: boolean; onSaved: () => void
}) {
  const current = row.target_krw != null ? String(row.target_krw) : ''
  const [digits, setDigits] = useState(current)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const hasStrategic = row.products.some((p) => p.strategic_price_krw != null)
  const perGpu = Number(digits)
  const canSave = !busy && Number.isFinite(perGpu) && perGpu > 0

  const run = async (job: () => Promise<boolean>) => {
    setBusy(true)
    setFailed(false)
    try {
      const ok = await job()
      if (ok) onSaved()
      else setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={s.pSection}>
      <h3 className={s.pHeading}>{C.panelFair}</h3>
      <p className={s.pSellLine}>{row.sale_krw != null && row.sale_ser != null ? C.panelSale(fmtKRW(row.sale_krw), row.sale_ser) : C.panelSaleNone}</p>
      <p className={s.pSellLine}>{fairLine(row, marginPct)}</p>
      {isAdmin && (
        <div className={s.pStrategic}>
          <label className={s.pLabel}>
            {C.strategicLabel}
            <MoneyField value={digits} onValueChange={setDigits} disabled={busy} />
          </label>
          <p className={s.pHint}>{C.strategicHint(row.products.length)}</p>
          <div className={s.pActions}>
            <button type="button" className="btn-primary" disabled={!canSave}
              onClick={() => void run(() => saveStrategic(row, perGpu))}>
              {C.strategicSave}
            </button>
            {hasStrategic && (
              <button type="button" className="btn-ghost" disabled={busy}
                onClick={() => void run(async () => { const ok = await clearStrategic(row); if (ok) setDigits(''); return ok })}>
                {C.strategicClear}
              </button>
            )}
          </div>
          {failed && <p role="alert" className={s.pError}>{C.strategicFailed}</p>}
        </div>
      )}
    </section>
  )
}
