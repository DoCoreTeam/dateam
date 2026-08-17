'use client'

// 견적 작성·수정
//
// **왜 모달인가**: 견적은 딜을 보면서 쓴다. 별도 화면으로 보내면 지금 보던 맥락
// (회사·단계·지난 미팅)이 끊기고, 사용자는 두 화면을 오가며 숫자를 옮겨 적는다.
//
// **합계는 여기서 계산하지만 저장하지 않는다.** 화면이 보여 주는 숫자는 미리보기이고,
// 저장되는 값은 서버가 같은 함수(quote-math)로 다시 계산한 것이다.
// 두 곳이 같은 함수를 쓰므로 눈에 보이는 값과 저장되는 값이 갈리지 않고,
// 브라우저를 조작해도 총액은 바뀌지 않는다.

import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import DateField, { todayPlus } from '@/components/ui/DateField'
import { computeLine, computeTotals, needsApproval, DEFAULT_DISCOUNT_APPROVAL_PCT } from '@/lib/crm/domain/quote-math'
import { formatAmount } from '@/app/(crm)/crm/deals/amount'
import styles from './quote-panel.module.css'

export interface QuoteLineDraft {
  id?: string | null
  name: string
  quantity: string
  unit: string
  unitPriceMinor: string
  discountPercent: string
  taxRate: string
}

export interface QuoteDraft {
  id?: string
  version?: number
  title: string
  currency: string
  validUntil: string
  notesMd: string
  status?: string
  lines: QuoteLineDraft[]
}

interface Props {
  dealId: string
  initial: QuoteDraft
  onClose: () => void
  onSaved: () => void
}

function emptyLine(): QuoteLineDraft {
  return { name: '', quantity: '1', unit: '', unitPriceMinor: '', discountPercent: '0', taxRate: '10' }
}

export function newQuoteDraft(dealName: string, currency: string | null): QuoteDraft {
  return {
    title: `${dealName} 견적`,
    currency: (currency ?? 'KRW').toUpperCase(),
    // 빈 칸으로 두면 사용자가 연도부터 타이핑하게 되고, 거기서 6자리 연도가 들어간다.
    // 견적 유효기간의 관례값(30일)을 미리 넣어 두고 필요하면 고치게 한다.
    validUntil: todayPlus(30),
    notesMd: '',
    lines: [emptyLine()],
  }
}

export default function QuoteEditorModal({ dealId, initial, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<QuoteDraft>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEdit = Boolean(draft.id)
  // 보낸 견적의 항목은 서버가 거절한다 — 화면에서도 미리 잠가 둔다.
  // 잠그지 않으면 사용자는 다 고친 뒤 저장에서야 "안 됩니다"를 듣는다.
  const linesLocked = Boolean(draft.status && draft.status !== 'DRAFT')

  const setLine = (i: number, patch: Partial<QuoteLineDraft>) => {
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    }))
  }

  const totals = useMemo(
    () => computeTotals(draft.lines.map((l) => ({
      quantity: l.quantity || 0,
      unitPriceMinor: l.unitPriceMinor || 0,
      discountPercent: l.discountPercent || 0,
      taxRate: l.taxRate || 0,
    }))),
    [draft.lines],
  )
  const approval = needsApproval(totals)

  const save = async () => {
    setError(null)

    // 빈 줄은 저장하지 않는다 — 사용자가 실수로 남긴 마지막 빈 칸이 항목으로 남으면
    // 견적서에 이름 없는 0원 줄이 인쇄된다
    const lines = draft.lines
      .filter((l) => l.name.trim().length > 0)
      .map((l) => ({
        id: l.id ?? null,
        name: l.name.trim(),
        quantity: l.quantity || '1',
        unit: l.unit.trim() || null,
        unitPriceMinor: l.unitPriceMinor || '0',
        discountPercent: l.discountPercent || '0',
        taxRate: l.taxRate || '10',
      }))

    if (!draft.title.trim()) { setError('견적 제목을 입력해 주세요.'); return }
    if (lines.length === 0) { setError('항목을 최소 하나 입력해 주세요. 이름이 있어야 저장됩니다.'); return }

    setSaving(true)
    try {
      const payload = {
        dealId,
        title: draft.title.trim(),
        currency: draft.currency,
        validUntil: draft.validUntil || null,
        notesMd: draft.notesMd.trim() || null,
        ...(linesLocked ? {} : { lines }),
        ...(isEdit ? { version: draft.version } : {}),
      }
      const res = await fetch(isEdit ? `/api/crm/quotes/${draft.id}` : '/api/crm/quotes', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) {
        // 서버가 무엇이 문제인지 한국어로 말한다 — 그 말을 그대로 보여 준다
        setError(body?.error?.message ?? '견적을 저장하지 못했습니다.')
        return
      }
      onSaved()
    } catch {
      setError('견적을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <NbModal
      title={isEdit ? '견적 수정' : '견적 작성'}
      onClose={onClose}
      maxWidth={980}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <NbButton variant="ghost" onClick={onClose} disabled={saving}>취소</NbButton>
          <NbButton onClick={() => void save()} disabled={saving}>
            {saving ? '저장하는 중…' : '저장'}
          </NbButton>
        </div>
      }
    >
      <div className={styles.form}>
        {error && <FormErrorBanner message={error} />}

        <div className={styles.headFields}>
          <div className={styles.field}>
            <label className="label" htmlFor="quote-title">제목</label>
            <input
              id="quote-title"
              className="input-field"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="예: 2026년 GPU 인프라 구축 견적"
            />
          </div>
          <div className={styles.field}>
            <label className="label" htmlFor="quote-valid">유효기간</label>
            <DateField
              id="quote-valid"
              value={draft.validUntil}
              onValueChange={(v) => setDraft((d) => ({ ...d, validUntil: v }))}
            />
          </div>
        </div>

        <div className={styles.linesHead}>
          <span className={styles.sectionTitle}>항목</span>
          {!linesLocked && (
            <NbButton
              variant="ghost"
              onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, emptyLine()] }))}
            >
              <Plus size={16} /> 항목 추가
            </NbButton>
          )}
        </div>

        {linesLocked && (
          <div className={styles.approvalNote}>
            이미 보낸 견적이라 항목은 수정할 수 없어요. 금액을 바꾸려면 새 견적을 만들어 주세요.
          </div>
        )}

        <div className={styles.lines}>
          {draft.lines.map((line, i) => {
            const amounts = computeLine({
              quantity: line.quantity || 0,
              unitPriceMinor: line.unitPriceMinor || 0,
              discountPercent: line.discountPercent || 0,
              taxRate: line.taxRate || 0,
            })
            return (
              <div className={styles.line} key={line.id ?? `new-${i}`}>
                <div className={styles.field}>
                  <label className="label" htmlFor={`ln-name-${i}`}>품목</label>
                  <input
                    id={`ln-name-${i}`}
                    className="input-field"
                    value={line.name}
                    disabled={linesLocked}
                    onChange={(e) => setLine(i, { name: e.target.value })}
                    placeholder="예: H100 80GB SXM"
                  />
                </div>
                <div className={styles.field}>
                  <label className="label" htmlFor={`ln-qty-${i}`}>수량</label>
                  <input
                    id={`ln-qty-${i}`}
                    className="input-field"
                    inputMode="decimal"
                    value={line.quantity}
                    disabled={linesLocked}
                    onChange={(e) => setLine(i, { quantity: e.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <label className="label" htmlFor={`ln-unit-${i}`}>단위</label>
                  <input
                    id={`ln-unit-${i}`}
                    className="input-field"
                    value={line.unit}
                    disabled={linesLocked}
                    onChange={(e) => setLine(i, { unit: e.target.value })}
                    placeholder="개월"
                  />
                </div>
                <div className={styles.field}>
                  <label className="label" htmlFor={`ln-price-${i}`}>단가</label>
                  <input
                    id={`ln-price-${i}`}
                    className="input-field"
                    inputMode="numeric"
                    value={line.unitPriceMinor}
                    disabled={linesLocked}
                    onChange={(e) => setLine(i, { unitPriceMinor: e.target.value.replace(/[^\d]/g, '') })}
                    placeholder="0"
                  />
                </div>
                <div className={styles.field}>
                  <label className="label" htmlFor={`ln-disc-${i}`}>할인 %</label>
                  <input
                    id={`ln-disc-${i}`}
                    className="input-field"
                    inputMode="decimal"
                    value={line.discountPercent}
                    disabled={linesLocked}
                    onChange={(e) => setLine(i, { discountPercent: e.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <label className="label" htmlFor={`ln-tax-${i}`}>부가세 %</label>
                  <input
                    id={`ln-tax-${i}`}
                    className="input-field"
                    inputMode="decimal"
                    value={line.taxRate}
                    disabled={linesLocked}
                    onChange={(e) => setLine(i, { taxRate: e.target.value })}
                  />
                </div>
                <div>
                  <div className={styles.lineTotal}>
                    {formatAmount(amounts.lineTotalMinor.toString(), draft.currency)}
                  </div>
                  {!linesLocked && draft.lines.length > 1 && (
                    <button
                      type="button"
                      className={styles.lineRemove}
                      aria-label={`${line.name || `${i + 1}번`} 항목 지우기`}
                      onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((_, idx) => idx !== i) }))}
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className={styles.totals}>
          <div className={styles.totalRow}>
            <span>소계</span><span>{formatAmount(totals.subtotalMinor.toString(), draft.currency)}</span>
          </div>
          <div className={styles.totalRow}>
            <span>할인</span>
            <span>{totals.discountMinor > BigInt(0) ? '− ' : ''}{formatAmount(totals.discountMinor.toString(), draft.currency)}</span>
          </div>
          <div className={styles.totalRow}>
            <span>부가세</span><span>{formatAmount(totals.taxMinor.toString(), draft.currency)}</span>
          </div>
          <div className={styles.grandRow}>
            <span>합계</span><span>{formatAmount(totals.totalMinor.toString(), draft.currency)}</span>
          </div>
        </div>

        {approval && (
          <div className={styles.approvalNote}>
            할인율이 {DEFAULT_DISCOUNT_APPROVAL_PCT}%를 넘었어요. 저장은 되지만,
            보내기 전에 승인을 받아야 합니다.
          </div>
        )}

        <div className={styles.field}>
          <label className="label" htmlFor="quote-notes">메모</label>
          <textarea
            id="quote-notes"
            className="input-field"
            rows={3}
            value={draft.notesMd}
            onChange={(e) => setDraft((d) => ({ ...d, notesMd: e.target.value }))}
            placeholder="납기·결제 조건처럼 견적서에 함께 적을 내용"
          />
        </div>
      </div>
    </NbModal>
  )
}
