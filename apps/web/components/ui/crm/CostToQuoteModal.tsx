'use client'

/**
 * 딜 원가로 견적 만들기
 *
 * **왜 이 창이 필요한가**: 받은 견적서를 딜 원가로 보내는 길은 있었는데
 * 거기서 **견적으로 되돌아오는 길이 없었다.** 그래서 사람이 같은 품목을
 * 편집기에 손으로 다시 적었고, 적는 동안 수량과 단가가 어긋났다.
 *
 * **이 창은 저장하지 않는다.** 고른 원가를 견적 **초안**으로 만들어 넘기고,
 * 편집기가 열린다 — 원가에서 바로 견적을 만들어 버리면 「원가 그대로 나간 견적」이
 * 조용히 생긴다. 값을 보고 저장하는 것은 사람의 일로 남긴다.
 *
 * **권한은 창구가 본다.** 원가를 읽으려면 `GET /api/crm/deals/:id/costs` 를 지나고
 * 그 창구가 `cost.view` 를 판정한다 — 403 이면 이 창은 아무것도 못 그린다.
 * 단추를 감추는 것으로 권한 검증을 대신하지 않는다(정책 F-N).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import NbModal from '@/components/ui/nb/NbModal'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import { formatAmount } from '@/app/(crm)/crm/deals/amount'
import { ACTION, QUOTE } from '@/lib/terms'
import { COST, COST_CATEGORY_LABEL, type CostCategory } from '@/lib/terms/cost'
import { CURRENCY_CHOICES } from '@/lib/crm/domain/currency'
import {
  costToQuoteLines, prefillMarginPct,
  type CostSource, type QuoteLineFromCost,
} from '@/lib/crm/domain/cost-to-quote'
import styles from './cost-panel.module.css'

interface CostJson extends CostSource {
  category: CostCategory
  /** 「이 숫자 어디서 왔지」 — 수량·단가가 없는 줄은 이것이 그 자리를 대신한다 */
  basisNote?: string | null
}

export interface CostToQuotePick {
  lines: QuoteLineFromCost[]
  currency: string
  /** 환산에 쓴 근거 — 넘겨받는 쪽이 사람에게 그대로 전한다 */
  fxRate: string | null
  fxDate: string | null
  note: string | null
}

interface Props {
  dealId: string
  dealCurrency: string | null
  onClose: () => void
  /** 만든 초안을 넘긴다 — 이 창은 저장하지 않는다 */
  onPicked: (pick: CostToQuotePick) => void
}

export default function CostToQuoteModal({ dealId, dealCurrency, onClose, onPicked }: Props) {
  const [items, setItems] = useState<CostJson[]>([])
  const [revenueMinor, setRevenueMinor] = useState('0')
  const [costTotalMinor, setCostTotalMinor] = useState('0')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [currency, setCurrency] = useState((dealCurrency ?? 'KRW').toUpperCase())
  const [margin, setMargin] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/crm/deals/${dealId}/costs`)
        if (res.status === 403) {
          // 「볼 수 없습니다」를 띄우지 않는다 — 원가가 있다는 사실 자체가 샌다
          onClose()
          return
        }
        const body = await res.json()
        if (!res.ok) { setError(body?.error?.message ?? '원가를 불러오지 못했습니다.'); return }
        const rows: CostJson[] = body.items ?? []
        setItems(rows)
        setRevenueMinor(String(body.revenueMinor ?? '0'))
        setCostTotalMinor(String(body.totals?.totalMinor ?? '0'))
        // 처음엔 전부 고른 상태 — 가져오려고 열었으므로 하나씩 켜게 하지 않는다
        setPicked(new Set(rows.map((r) => r.id)))
      } catch {
        setError('원가를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
      } finally {
        setLoading(false)
      }
    })()
  }, [dealId, onClose])

  /*
    **마진율을 딜이 스스로 말하는 값으로 채운다.** 수주 매출과 이 원가가 이미 마진율을
    정하고 있고, 그 값으로 견적을 만들면 견적 총액이 딜 금액과 어긋나지 않는다.
    지어낸 숫자가 아니고, 사람이 이 칸에서 보고 고친다.
  */
  useEffect(() => {
    if (loading) return
    setMargin((m) => (m === '' ? String(prefillMarginPct(revenueMinor, costTotalMinor)) : m))
  }, [loading, revenueMinor, costTotalMinor])

  const rows = useMemo(() => items.filter((i) => picked.has(i.id)), [items, picked])
  const result = useMemo(
    () => costToQuoteLines(rows, { currency, marginPercent: margin }),
    [rows, currency, margin],
  )

  const toggle = useCallback((id: string) => {
    setPicked((p) => {
      const next = new Set(p)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const apply = useCallback(() => {
    onPicked({
      lines: result.lines,
      currency,
      fxRate: result.fxRate,
      fxDate: result.fxDate,
      note: result.note,
    })
  }, [currency, onPicked, result])

  return (
    <NbModal
      title={QUOTE.fromDealCostTitle}
      onClose={onClose}
      maxWidth={640}
      footer={
        <div className={styles.modalFoot}>
          <NbButton variant="ghost" onClick={onClose}>{ACTION.cancel}</NbButton>
          <NbButton onClick={apply} disabled={result.lines.length === 0}>
            {QUOTE.fromDealCostApply}
          </NbButton>
        </div>
      }
    >
      {loading ? <AXDotLoader /> : error ? <ErrorState message={error} /> : items.length === 0 ? (
        <EmptyState title={QUOTE.fromDealCostEmpty} description={QUOTE.fromDealCostEmptyHint} />
      ) : (
        <div className={styles.form}>
          <div className={styles.field}>
            <span className="label">{QUOTE.fromDealCostPick}</span>
            <ul className={styles.list}>
              {items.map((it) => (
                <li key={it.id} className={styles.item}>
                  <label className={styles.itemName}>
                    <input
                      type="checkbox" checked={picked.has(it.id)}
                      onChange={() => toggle(it.id)}
                      aria-label={it.name}
                    />
                    {it.name}
                    <span className={styles.stage}>{COST_CATEGORY_LABEL[it.category]}</span>
                  </label>
                  <span className={styles.basis}>{lineBasis(it)}</span>
                  <span className={styles.amountCell}>
                    <span className={styles.itemAmount}>
                      {formatAmount(it.amountMinor, it.currency || currency) ?? '—'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label className="label" htmlFor="cost-quote-currency">{COST.currency}</label>
              <select
                id="cost-quote-currency" className="input-field" value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {CURRENCY_CHOICES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {/*
                **환산 근거는 고르는 이 자리에서 말한다.** 견적서에 인쇄되는 칸
                (특기사항·비고)에 적으면 「우리 값이 외화 매입에서 나왔다」가 고객에게 간다 —
                원가는 대외비다. 사람이 고르는 순간에 보이면 그것으로 충분하다.
              */}
              {result.fxRate && (
                <p className={styles.hint}>
                  {`1 ${foreignOf(rows, currency)} = ${Number(result.fxRate).toLocaleString('ko-KR')}원`}
                  {result.fxDate && ` · ${result.fxDate} ${COST.fxBasis}로 환산합니다`}
                </p>
              )}
            </div>

            <div className={styles.field}>
              <label className="label" htmlFor="cost-quote-margin">{QUOTE.fromDealCostMargin}</label>
              <input
                id="cost-quote-margin" className="input-field" inputMode="decimal" value={margin}
                onChange={(e) => setMargin(e.target.value)}
                placeholder="예: 20"
              />
              <p className={styles.hint}>{QUOTE.fromDealCostMarginHint}</p>
            </div>
          </div>

          {/* 무엇을 얼마로 올렸는지 — 말하지 않으면 조용히 바꾼 것이다 */}
          {result.note && <p className={styles.hint}>{result.note}</p>}

          {/*
            환율이 없어 못 옮기는 원가는 **옮기기 전에** 말한다.
            넘긴 뒤에 말하면 사람은 이미 견적을 만들고 있다.
          */}
          {result.skipped.length > 0 && (
            <p className={styles.fxWarn}>
              {`환율이 없어 ${result.skipped.length}건은 옮기지 못합니다 (${result.skipped.map((s) => s.name).join(', ')})`}
            </p>
          )}
        </div>
      )}
    </NbModal>
  )
}

/** 그 줄이 무엇이었나 — 수량과 단가가 있으면 그것을, 없으면 근거를 */
function lineBasis(it: CostJson): string {
  if (it.quantity && it.unitPriceMinor) {
    const unit = it.unit ? ` ${it.unit}` : ''
    return `${it.quantity}${unit} × ${formatAmount(it.unitPriceMinor, it.currency || 'KRW') ?? ''}`
  }
  return it.basisNote ?? ''
}

/** 환산한 통화가 무엇인가 — 고른 줄 중 견적 통화와 다른 첫 통화 */
function foreignOf(rows: readonly CostSource[], to: string): string {
  const row = rows.find((r) => (r.currency ?? to).toUpperCase() !== to.toUpperCase())
  return (row?.currency ?? to).toUpperCase()
}
