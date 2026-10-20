'use client'

// 예산 칸과 맞추기 단추 — 단가는 그대로 두고 할인 대상 줄의 할인 칸으로 맞춘다.
//
// 딜에 예산이 적혀 있으면 그 값을 채워 두고 「딜 예산」이라고 말한다. 맞추기는 단추 한 번이다 —
// 다른 칸은 자동으로 채우지만 할인은 회사가 주는 돈이라 예산만 보고 몰래 넣지 않는다.
// 승인 기준을 넘는 할인이 필요하면 거기서 멈추고 「할인 n% 넣기」를 사람이 누른다.

import { useEffect, useState } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import { PRICEBOOK, BUDGET_SENTENCE } from '@/lib/terms'
import type { QuoteDraft } from '../quote-draft-shape'
import { fitDraftToBudget } from './draft-budget'
import styles from './quote-fill.module.css'

interface Props {
  dealId: string
  draft: QuoteDraft
  onDraftChange: (fn: (prev: QuoteDraft) => QuoteDraft) => void
  approvalRequired: boolean
  disabled?: boolean
}

const digits = (v: string) => v.replace(/[^\d]/g, '')

export default function BudgetFit({ dealId, draft, onDraftChange, approvalRequired, disabled }: Props) {
  const [budget, setBudget] = useState(draft.budgetMinor ?? '')
  const [withTax, setWithTax] = useState(draft.budgetIncludesTax ?? false)
  const [fromDeal, setFromDeal] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [neededPct, setNeededPct] = useState<number | null>(null)

  // 글로 읽은 예산이 오면 칸이 그 값을 따른다 — 처음 값만 들고 있으면 칸과 글이 다른 예산을 말한다
  useEffect(() => {
    if (!draft.budgetMinor) return
    setBudget(draft.budgetMinor)
    setWithTax(draft.budgetIncludesTax ?? false)
    setFromDeal(false)
  }, [draft.budgetMinor, draft.budgetIncludesTax])

  useEffect(() => {
    if (draft.budgetMinor) return
    let alive = true
    void (async () => {
      try {
        const res = await fetch(`/api/crm/deals/${dealId}`)
        const deal = await res.json()
        if (alive && res.ok && deal?.budgetNetMinor) { setBudget(String(deal.budgetNetMinor)); setFromDeal(true) }
      } catch { /* 딜 예산을 못 읽어도 사람이 적으면 된다 */ }
    })()
    return () => { alive = false }
  }, [dealId]) // eslint-disable-line react-hooks/exhaustive-deps

  const fit = (allowOverCap = false) => {
    if (!budget) return
    const out = fitDraftToBudget(draft, BigInt(budget), withTax, { allowOverCap })
    onDraftChange(() => out.draft)
    setMessage(out.message)
    setNeededPct(out.neededPct)
  }

  return (
    <div className={styles.inline}>
      <label className="label" htmlFor="qb-budget">{PRICEBOOK.budget}</label>
      <input id="qb-budget" className="input-field" inputMode="numeric" value={budget} disabled={disabled}
        onChange={(e) => { setBudget(digits(e.target.value)); setFromDeal(false) }} placeholder="원" />
      <label className={styles.small}><input type="checkbox" checked={withTax} disabled={disabled} onChange={(e) => setWithTax(e.target.checked)} /> {PRICEBOOK.budgetIncludesTax}</label>
      {fromDeal && budget && <span className={styles.chip}>{BUDGET_SENTENCE.dealBudget(Number(budget).toLocaleString('ko-KR'))}</span>}
      <NbButton variant="ghost" onClick={() => fit()} disabled={disabled || !budget}>{PRICEBOOK.fitBudget}</NbButton>
      {neededPct !== null && <NbButton variant="ghost" onClick={() => fit(true)} disabled={disabled}>{BUDGET_SENTENCE.applyNeeded(neededPct)}</NbButton>}
      {message && <p className={styles.small} role="status">{message}{approvalRequired ? ` ${BUDGET_SENTENCE.approval}` : ''}</p>}
    </div>
  )
}
