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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import DateField, { todayPlus } from '@/components/ui/DateField'
import RecordPickerField, { type RecordOption, type RecordSearch } from '@/components/ui/RecordPicker'
import { computeLine, computeTotals, needsApproval, DEFAULT_DISCOUNT_APPROVAL_PCT } from '@/lib/crm/domain/quote-math'
import { formatAmount } from '@/app/(crm)/crm/deals/amount'
import {
  ACTION,
  progress,
  QUOTE,
  quoteEditTitle,
  QUOTE_LINES_LOCKED,
  approvalNeeded,
} from '@/lib/terms'
import styles from './quote-panel.module.css'

export interface QuoteLineDraft {
  id?: string | null
  /** 카탈로그의 어느 품목인지. 손으로 적기만 한 옛 항목은 null 이다 */
  productId?: string | null
  name: string
  /** 규격·설명 — 견적서에 품목 아래 작게 인쇄된다 */
  descriptionMd: string
  quantity: string
  unit: string
  unitPriceMinor: string
  discountPercent: string
  taxRate: string
}

/** `/api/crm/products` 가 주는 모양 (금액은 BigInt 라 문자열로 온다) */
interface ProductJson {
  id: string
  name: string
  sku: string | null
  unitPriceMinor: string
  currency: string
  taxRate: string
  unit: string | null
}

export interface QuoteDraft {
  id?: string
  version?: number
  title: string
  currency: string
  validUntil: string
  notesMd: string
  status?: string
  /**
   * 공급받는 곳의 담당자 — 「○○ 귀하」로 문서에 찍힌다.
   * **안 고르면 안 나온다.** 회사 앞으로만 보내는 견적이 흔하고,
   * 억지로 채우게 하면 아무나 골라 넣는다(사용자 지시).
   */
  recipientPersonId: string | null
  lines: QuoteLineDraft[]
}

interface Props {
  dealId: string
  initial: QuoteDraft
  onClose: () => void
  onSaved: () => void
}

/** 고르는 목록에 실리는 모양 — SKU 는 이름이 겹칠 때 구분해 주는 보조 정보다 */
function toOption(p: ProductJson): RecordOption {
  return { id: p.id, name: p.name, hint: p.sku || undefined }
}

function emptyLine(): QuoteLineDraft {
  return { productId: null, name: '', descriptionMd: '', quantity: '1', unit: '', unitPriceMinor: '', discountPercent: '0', taxRate: '10' }
}

export function newQuoteDraft(dealName: string, currency: string | null, validDays = 30): QuoteDraft {
  return {
    title: `${dealName} 견적`,
    currency: (currency ?? 'KRW').toUpperCase(),
    // 빈 칸으로 두면 사용자가 연도부터 타이핑하게 되고, 거기서 6자리 연도가 들어간다.
    // **기본 일수는 설정에서 온다** — 예전엔 30이 여기 박혀 있어 바꾸려면 배포를 해야 했다.
    validUntil: todayPlus(validDays),
    notesMd: '',
    recipientPersonId: null,
    lines: [emptyLine()],
  }
}

/**
 * 서버가 준 견적을 **편집 초안**으로.
 *
 * **왜 여기 있나**: 딜 상세(QuotePanel)와 견적 상세가 같은 모달을 여는데,
 * 이 변환을 각자 하면 한쪽에만 새 칸을 더하는 날이 온다 —
 * 그러면 그 화면에서 고친 값이 **저장하는 순간 조용히 사라진다**.
 * 모달이 쓰는 모양이니 모달이 정의한다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function quoteToDraft(body: any): QuoteDraft {
  return {
    id: body.id,
    version: body.version,
    title: body.title,
    currency: body.currency,
    validUntil: body.validUntil ? String(body.validUntil).slice(0, 10) : '',
    notesMd: body.notesMd ?? '',
    status: body.status,
    recipientPersonId: body.recipientPersonId ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lines: (body.lines ?? []).map((l: any) => ({
      id: l.id,
      // 카탈로그 연결을 들고 가지 않으면 저장하는 순간 손으로 친 이름으로 되돌아간다
      productId: l.productId ?? null,
      name: l.name,
      descriptionMd: l.descriptionMd ?? '',
      quantity: String(l.quantity),
      unit: l.unit ?? '',
      unitPriceMinor: String(l.unitPriceMinor),
      discountPercent: String(l.discountPercent),
      taxRate: String(l.taxRate),
    })),
  }
}

export default function QuoteEditorModal({ dealId, initial, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<QuoteDraft>(initial)
  /**
   * 이 딜에 붙은 사람들 — 견적을 «누구 앞으로» 보내는지 고르는 후보다.
   * 회사 전체 인물이 아니라 **딜에 붙은 사람만** 준다: 견적은 이 건의 문서이고,
   * 회사에 100명이 있어도 이 건과 상관없는 사람을 고를 이유가 없다.
   */
  const [people, setPeople] = useState<{ id: string; name: string; title: string | null }[]>([])
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch(`/api/crm/deals/${dealId}/contacts`)
        if (!res.ok) return
        const body = await res.json()
        if (!alive) return
        setPeople((body.items ?? []).map((c: { personId: string; name?: string; personName?: string; title?: string | null }) => ({
          id: c.personId, name: c.personName ?? c.name ?? '(이름 없음)', title: c.title ?? null,
        })))
      } catch { /* 후보를 못 불러와도 견적은 저장된다 — 담당자는 선택 사항이다 */ }
    })()
    return () => { alive = false }
  }, [dealId])
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

  /**
   * 검색·생성으로 스쳐 간 품목의 원본을 들고 있는다.
   * 고르는 부품은 id·이름·힌트만 나르므로, 단가·단위·세율은 여기서 꺼내야 한다.
   */
  const catalog = useRef<Map<string, ProductJson>>(new Map())

  /**
   * **신원이 고정돼야 한다.** 이 함수는 고르는 모달의 effect 의존성이라
   * 렌더마다 새 함수를 주면 검색이 끝없이 다시 돈다.
   */
  const searchProducts = useCallback<RecordSearch>(async (query, signal) => {
    const res = await fetch(`/api/crm/products?q=${encodeURIComponent(query)}`, { signal })
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error?.message ?? '품목을 불러오지 못했습니다.')
    const items = (body.items ?? []) as ProductJson[]
    items.forEach((p) => catalog.current.set(p.id, p))
    return items.map(toOption)
  }, [])

  /** 고른 품목의 단가·단위·세율을 그 줄에 옮긴다 — 카탈로그를 만든 이유가 이것이다 */
  const pickProduct = (i: number, opt: RecordOption | null) => {
    if (!opt) { setLine(i, { productId: null }); return }
    const p = catalog.current.get(opt.id)
    const patch: Partial<QuoteLineDraft> = { productId: opt.id, name: opt.name }
    // 단가 0 은 "아직 안 정했다"는 뜻이다 — 사람이 친 금액을 0 으로 덮으면 그게 손해다
    if (p && p.unitPriceMinor !== '0') patch.unitPriceMinor = p.unitPriceMinor
    if (p?.unit) patch.unit = p.unit
    if (p?.taxRate) patch.taxRate = p.taxRate
    setLine(i, patch)
  }

  /**
   * 카탈로그에 없으면 그 자리에서 만든다.
   * 설정 화면으로 보내면 쓰던 견적을 잃는다 — 그래서 지금 친 단가·단위·세율을 함께 실어 보낸다.
   */
  const createProduct = async (i: number, name: string): Promise<RecordOption | null> => {
    const line = draft.lines[i]
    const res = await fetch('/api/crm/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        currency: draft.currency,
        unitPriceMinor: line?.unitPriceMinor || '0',
        unit: line?.unit || null,
        taxRate: line?.taxRate || '10',
      }),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error?.message ?? '품목을 만들지 못했습니다.')
    const made = body as ProductJson
    catalog.current.set(made.id, made)
    return toOption(made)
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
        // 카탈로그와의 연결 — 안 실으면 고른 품목이 저장 순간 다시 손으로 친 이름이 된다
        productId: l.productId ?? null,
        name: l.name.trim(),
        descriptionMd: l.descriptionMd.trim() || null,
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
        recipientPersonId: draft.recipientPersonId,
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
      title={quoteEditTitle(isEdit)}
      onClose={onClose}
      maxWidth={980}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <NbButton variant="ghost" onClick={onClose} disabled={saving}>{ACTION.cancel}</NbButton>
          <NbButton onClick={() => void save()} disabled={saving}>
            {saving ? progress(ACTION.save) : ACTION.save}
          </NbButton>
        </div>
      }
    >
      <div className={styles.form}>
        {error && <FormErrorBanner message={error} />}

        <div className={styles.headFields}>
          <div className={styles.field}>
            <label className="label" htmlFor="quote-title">{QUOTE.title}</label>
            <input
              id="quote-title"
              className="input-field"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="예: 2026년 GPU 인프라 구축 견적"
            />
          </div>
          <div className={styles.field}>
            <label className="label" htmlFor="quote-valid">{QUOTE.validUntil}</label>
            <DateField
              id="quote-valid"
              value={draft.validUntil}
              onValueChange={(v) => setDraft((d) => ({ ...d, validUntil: v }))}
            />
          </div>
          {/*
            받는 사람. 딜에 사람이 하나도 안 붙어 있으면 고를 것이 없으므로 자리를 만들지 않는다 —
            빈 드롭다운은 «고를 수 있는데 비었다»로 읽혀 사람을 헤매게 한다.
          */}
          {people.length > 0 && (
            <div className={styles.field}>
              <label className="label" htmlFor="quote-recipient">{QUOTE.recipient}</label>
              <select
                id="quote-recipient"
                className="input-field"
                value={draft.recipientPersonId ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, recipientPersonId: e.target.value || null }))}
              >
                <option value="">{QUOTE.recipientNone}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.title ? `${p.name} ${p.title}` : p.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className={styles.linesHead}>
          <span className={styles.sectionTitle}>{QUOTE.lines}</span>
          {!linesLocked && (
            <NbButton
              variant="ghost"
              onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, emptyLine()] }))}
            >
              <Plus size={16} /> {QUOTE.addLine}
            </NbButton>
          )}
        </div>

        {linesLocked && (
          <div className={styles.approvalNote}>
            {QUOTE_LINES_LOCKED}
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
                  <label className="label" htmlFor={`ln-name-${i}`}>{QUOTE.lineName}</label>
                  {/*
                    카탈로그에서 고른다 — 늘어나는 목록이라 검색 모달이 표준이다.
                    value 에 이름을 폴백으로 넣는 이유: 옛 항목은 productId 가 없어
                    id 만 보면 "아직 안 고름"으로 읽히고 품목이 사라진 것처럼 보인다.
                  */}
                  <RecordPickerField
                    id={`ln-name-${i}`}
                    noun="품목"
                    value={line.productId || line.name}
                    valueName={line.name}
                    onChange={(opt) => pickProduct(i, opt)}
                    search={searchProducts}
                    onCreate={(name) => createProduct(i, name)}
                    disabled={linesLocked}
                    placeholder="예: H100 80GB SXM"
                  />
                </div>
                <div className={styles.field}>
                  {/*
                    규격·설명 — 견적서에서 품목 이름 아래 작게 인쇄된다.
                    DB 에는 자리가 있었는데 폼에 칸이 없어 **아무도 못 채웠다**.
                    「H100 80GB」만으로는 SXM 인지 PCIe 인지 고객이 알 수 없다.
                  */}
                  <label className="label" htmlFor={`ln-spec-${i}`}>{QUOTE.lineSpec}</label>
                  <input
                    id={`ln-spec-${i}`}
                    className="input-field"
                    value={line.descriptionMd}
                    disabled={linesLocked}
                    onChange={(e) => setLine(i, { descriptionMd: e.target.value })}
                    placeholder="예: SXM5 · 3년 무상보증"
                  />
                </div>
                <div className={styles.field}>
                  <label className="label" htmlFor={`ln-qty-${i}`}>{QUOTE.lineQuantity}</label>
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
                  <label className="label" htmlFor={`ln-unit-${i}`}>{QUOTE.lineUnit}</label>
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
                  <label className="label" htmlFor={`ln-price-${i}`}>{QUOTE.lineUnitPrice}</label>
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
                  <label className="label" htmlFor={`ln-disc-${i}`}>{QUOTE.lineDiscount} %</label>
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
                  <label className="label" htmlFor={`ln-tax-${i}`}>{QUOTE.tax} %</label>
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
                      aria-label={`${line.name || `${i + 1}번`} ${QUOTE.removeLine}`}
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
            <span>{QUOTE.subtotal}</span><span>{formatAmount(totals.subtotalMinor.toString(), draft.currency)}</span>
          </div>
          <div className={styles.totalRow}>
            <span>{QUOTE.discount}</span>
            <span>{totals.discountMinor > BigInt(0) ? '− ' : ''}{formatAmount(totals.discountMinor.toString(), draft.currency)}</span>
          </div>
          <div className={styles.totalRow}>
            <span>{QUOTE.tax}</span><span>{formatAmount(totals.taxMinor.toString(), draft.currency)}</span>
          </div>
          <div className={styles.grandRow}>
            <span>{QUOTE.total}</span><span>{formatAmount(totals.totalMinor.toString(), draft.currency)}</span>
          </div>
        </div>

        {approval && (
          <div className={styles.approvalNote}>{approvalNeeded(DEFAULT_DISCOUNT_APPROVAL_PCT)}</div>
        )}

        <div className={styles.field}>
          <label className="label" htmlFor="quote-notes">{QUOTE.customerNote}</label>
          <textarea
            id="quote-notes"
            className="input-field"
            rows={3}
            value={draft.notesMd}
            onChange={(e) => setDraft((d) => ({ ...d, notesMd: e.target.value }))}
            placeholder="견적서에 그대로 인쇄됩니다. 납기·설치 범위처럼 고객이 알아야 할 것을 적어 주세요."
          />
        </div>
      </div>
    </NbModal>
  )
}
