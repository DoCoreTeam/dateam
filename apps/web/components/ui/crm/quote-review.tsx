'use client'

// 읽은 견적 한 건을 **사람이 보는 자리**
//
// ## 왜 부품으로 떼어냈나
//
// 파일에서 읽은 값을 검수하는 화면이 둘이 됐다. 편집 모달의 「파일로 채우기」와
// 딜 화면의 「파일로 가져오기」다. 두 곳에 같은 목록을 따로 그리면 한쪽에만 위험 표시가
// 붙거나 한쪽만 합계를 대조하게 되고, **검수 없는 쪽으로 틀린 값이 들어온다.**
// 이 저장소가 반복한 사고가 정확히 그 모양이다(로직은 다 있고 화면만 안 불렀다).
//
// ## 여기서 하지 않는 것
//
// **계산하지 않는다.** 줄 금액과 합계 대조는 `quote-reconcile`(순수·가드 20개)이 낸다.
// **정하지 않는다.** 이 건을 새 견적으로 쓸지 원가로 넣을지는 부르는 쪽이 정한다.
// 여기는 읽은 것을 보이고, 체크 상태를 위로 올릴 뿐이다.

import { FileText } from 'lucide-react'
import {
  checkLine, checkTotal, initialChecked,
  type LineCheck, type LineCheckInput, type TotalCheck,
} from '@/lib/crm/domain/quote-reconcile'
import { formatAmount } from '@/app/(crm)/crm/deals/amount'
import { LINE_KIND_ORDER, LINE_KIND_UNIT, type QuoteLineKind } from '@/lib/terms/cost'
import {
  FILL_NO_PRICE, FILL_SOURCE_LABEL, FILL_RISK_TEXT,
  FILL_TOTAL_MATCH, FILL_TOTAL_NO_REFERENCE, fillTotalMismatch,
  FILL_TOTAL_OURS, FILL_TOTAL_DOCUMENT, fillFoundLine,
  fillQuoteName, fillPickTitle, countOnly,
} from '@/lib/terms'
import type { QuoteDraft, QuoteLineDraft } from './quote-draft-shape'
import styles from './quote-panel.module.css'

/** 창구가 돌려주는 항목 한 줄 */
export interface DocLineJson {
  name: string | null
  spec: string | null
  kind: string | null
  quantity: number | null
  unit: string | null
  unitPriceMinor: number | null
  discountPercent: number | null
  specialDiscountPercent: number | null
  amountMinor: number | null
  sourceText: string
}

/** 창구가 돌려주는 건 하나 */
export interface DocQuoteJson {
  label: string | null
  title: string | null
  currency: string | null
  customerName: string | null
  supplierName: string | null
  lines: DocLineJson[]
  taxPercent: number | null
  sourceTotalMinor: number | null
  sourceTotalIncludesTax: boolean
  /** 우리가 낸 문서로 보이나 — **알림이다. 아무것도 바꾸지 않는다** */
  origin: 'ours' | 'received' | 'unknown'
}

/** 파일에서 읽은 것을 사람이 보는 동안 들고 있는 값 */
export interface FileReview {
  /** 건이 여럿일 때 어느 건인지 — 응답 배열의 자리 */
  index: number
  label: string | null
  title: string | null
  origin: DocQuoteJson['origin']
  lines: QuoteLineDraft[]
  /** 줄마다 원문 조각 — 같은 인덱스 */
  sources: string[]
  /** 줄마다 대조 결과 — 같은 인덱스 */
  checks: LineCheck[]
  /** 줄마다 넣을지 — 같은 인덱스 */
  checked: boolean[]
  /** 문서 맨 아래 합계와의 대조 */
  total: TotalCheck
  currency: string
}

/** 창구가 준 줄을 폼 모양으로. 두 화면이 같은 함수를 쓴다 */
export function toFormLine(l: DocLineJson, taxPercent: number | null): QuoteLineDraft {
  const k = (LINE_KIND_ORDER as readonly string[]).includes(l.kind ?? '')
    ? l.kind as QuoteLineKind : 'QUANTITY'
  return {
    productId: null,
    name: l.name ?? '',
    descriptionMd: l.spec ?? '',
    kind: k,
    quantity: l.quantity === null ? '1' : String(l.quantity),
    unit: l.unit ?? LINE_KIND_UNIT[k],
    // **못 읽은 단가는 빈 칸으로 둔다.** '0' 으로 채우면 0원짜리 줄이 조용히 들어간다
    unitPriceMinor: l.unitPriceMinor === null ? '' : String(l.unitPriceMinor),
    discountPercent: l.discountPercent === null ? '0' : String(l.discountPercent),
    specialDiscountPercent: l.specialDiscountPercent === null ? '' : String(l.specialDiscountPercent),
    taxRate: taxPercent === null ? '10' : String(taxPercent),
  }
}

/**
 * 읽은 건 하나를 검수할 모양으로 편다.
 *
 * **읽은 값을 원문과 맞춰 본다.** 견적서에는 줄마다 금액이 적혀 있고 맨 아래 합계가 있다 —
 * 즉 답이 문서 안에 이미 있다. 그 둘과 우리 계산을 견주면 잘못 읽은 줄이 스스로 드러난다.
 * 계산은 `quote-reconcile`(순수·가드 20개)이 하고 여기서는 결과만 담는다.
 */
export function buildReview(
  quote: DocQuoteJson,
  index: number,
  fallbackCurrency: string | null,
): FileReview {
  const usable = (quote.lines ?? []).filter((l) => l.name)
  const lines = usable.map((l) => toFormLine(l, quote.taxPercent))
  const sources = usable.map((l) => l.sourceText ?? '')

  const inputs: LineCheckInput[] = lines.map((l, i) => ({
    name: l.name,
    quantity: l.quantity,
    unitPriceMinor: l.unitPriceMinor,
    discountPercent: l.discountPercent,
    specialDiscountPercent: l.specialDiscountPercent,
    taxRate: l.taxRate,
    documentAmountMinor: usable[i].amountMinor,
    sourceText: sources[i],
  }))
  const checks = inputs.map(checkLine)

  return {
    index,
    label: quote.label,
    title: quote.title,
    origin: quote.origin,
    lines,
    sources,
    checks,
    // **위험 신호가 붙은 줄은 꺼 둔다** — 켜는 행동 자체가 「내가 봤다」는 뜻이 되게
    checked: initialChecked(checks),
    total: checkTotal({
      lines: inputs,
      documentTotalMinor: quote.sourceTotalMinor,
      documentIncludesTax: Boolean(quote.sourceTotalIncludesTax),
    }),
    currency: (quote.currency ?? fallbackCurrency ?? 'KRW').toUpperCase(),
  }
}

/**
 * 파일 한 장에서 읽은 건을 **전부** 편다.
 *
 * 첫 건만 펴고 나머지를 미루면, 고르는 목록에 「품목 몇 개 · 얼마」를 못 적는다 —
 * 그 둘이 없으면 사람은 이름만 보고 골라야 하고, 이름은 문서가 안 줄 때가 많다.
 * 품목이 하나도 없는 건은 **버린다**. 고를 수 없는 것을 목록에 세우면 고른 뒤에야 빈 것을 안다.
 */
export function buildReviews(
  quotes: DocQuoteJson[],
  fallbackCurrency: string | null,
): FileReview[] {
  return quotes
    .map((q, i) => buildReview(q, i, fallbackCurrency))
    .filter((r) => r.lines.length > 0)
}

/** 체크 하나 뒤집기 — 배열을 갈아 끼우지 않고 새로 만든다 */
export function toggleChecked(review: FileReview, i: number): FileReview {
  return { ...review, checked: review.checked.map((c, j) => (j === i ? !c : c)) }
}

/**
 * 체크된 줄의 **자리**.
 *
 * 원가로 보낼 때는 줄만으로 모자란다 — 금액 대조 결과(`checks`)와 원문 조각(`sources`)이
 * 같은 자리에 있고, 걸러낸 뒤에는 그 자리를 되찾을 수 없다.
 */
export function pickedIndexes(review: FileReview): number[] {
  return review.lines.map((_, i) => i).filter((i) => review.checked[i])
}

/** 체크된 줄만 */
export function pickedLines(review: FileReview): QuoteLineDraft[] {
  return pickedIndexes(review).map((i) => review.lines[i])
}

/**
 * 읽은 항목을 폼에 **얹는다** — 지금 있는 항목을 지우지 않고 뒤에 붙인다.
 *
 * 빈 줄 하나뿐일 때만 갈아 끼운다. 새 견적의 그 한 줄은 «아직 아무것도 안 적은 상태»이고,
 * 거기에 이어 붙이면 이름 없는 0원 줄이 견적서 맨 위에 남는다.
 */
export function appendLines(prev: QuoteDraft, made: QuoteLineDraft[]): QuoteLineDraft[] {
  if (made.length === 0) return prev.lines
  const onlyEmpty = prev.lines.length === 1 && !prev.lines[0].name.trim()
  return onlyEmpty ? made : [...prev.lines, ...made]
}

/**
 * 합계 대조를 **한 문장으로**.
 *
 * JSX 안에서 갈래를 세 번 치면 `diffMinor !== null` 이 안쪽까지 안 따라가고,
 * 무엇보다 읽는 사람이 세 갈래를 눈으로 합쳐야 한다.
 */
export function totalWordOf(review: FileReview): string {
  const t = review.total
  if (t.verdict === 'match') return FILL_TOTAL_MATCH
  if (t.verdict === 'no_reference') return FILL_TOTAL_NO_REFERENCE
  const diff = t.diffMinor ?? BigInt(0)
  const short = diff < BigInt(0)
  // formatAmount 는 못 만들면 null 을 준다. 그때 「 원 차이」라고 쓰면 빈칸이 인쇄된다
  const text = formatAmount((short ? -diff : diff).toString(), review.currency)
    ?? (short ? -diff : diff).toString()
  return fillTotalMismatch(text, short)
}

/** 읽은 건 하나의 제목 줄 — 파일 이름과 항목 수 */
export function ReviewHead({ review, fileName }: { review: FileReview; fileName: string }) {
  return (
    <div className={styles.reviewHead}>
      <FileText size={16} aria-hidden />
      <b>{fillFoundLine(review.lines.length, fileName)}</b>
    </div>
  )
}

/**
 * 검수 목록 — **넣기 전에 본다.**
 *
 * 체크한 것만 들어간다(§5-3 추출/제안형 — 자동 등록 금지).
 * 줄마다 원문 조각을 옆에 둬서, 사람이 숫자를 원문과 견줄 수 있게 한다.
 */
export function QuoteReviewList({ review, onToggle }: {
  review: FileReview
  onToggle: (index: number) => void
}) {
  return (
    <>
      {/*
        **합계 대조** — 이 기능의 안전장치다.

        줄이 다 맞는데 합계가 모자라면 **항목을 빠뜨린 것**이고, 남으면 합계 줄을
        항목으로 읽은 것이다. 둘은 사람이 할 일이 다르므로 따로 말한다.
        **맞았을 때도 말한다** — 말이 없으면 안 본 것과 구분되지 않는다.
      */}
      <div className={styles.totalCheck} data-verdict={review.total.verdict}>
        <span className={styles.totalCheckSum}>
          <span>{FILL_TOTAL_OURS}</span>
          <b>{formatAmount(review.total.ourTotalMinor.toString(), review.currency)}</b>
          {review.total.documentTotalMinor !== null && (
            <>
              <span className={styles.totalCheckVs}>/</span>
              <span>{FILL_TOTAL_DOCUMENT}</span>
              <b>{formatAmount(review.total.documentTotalMinor.toString(), review.currency)}</b>
            </>
          )}
        </span>
        <span className={styles.totalCheckWord}>{totalWordOf(review)}</span>
      </div>

      <ul className={styles.reviewList}>
        {review.lines.map((l, i) => (
          <li key={i} className={styles.reviewItem} data-risk={review.checks[i].safe ? undefined : 'on'}>
            <label className={styles.reviewPick}>
              <input
                type="checkbox"
                checked={review.checked[i]}
                onChange={() => onToggle(i)}
              />
              <span className={styles.reviewName}>{l.name}</span>
            </label>
            <span className={styles.reviewNums}>
              {l.quantity}{l.unit} · {l.unitPriceMinor === ''
                ? <em className={styles.reviewMissing}>{FILL_NO_PRICE}</em>
                : formatAmount(review.checks[i].ourAmountMinor.toString(), review.currency)}
            </span>
            {/*
              **걸린 이유를 줄 옆에 적는다.** 체크가 꺼져 있는 것만으로는
              사람이 「왜 꺼졌지」를 모르고, 모르면 그냥 다시 켠다.
            */}
            {review.checks[i].reasons.length > 0 && (
              <span className={styles.reviewRisk}>
                {review.checks[i].reasons.map((r) => FILL_RISK_TEXT[r]).join(' · ')}
              </span>
            )}
            {review.sources[i] && (
              <span className={styles.reviewSource}>
                <span className={styles.reviewSourceLabel}>{FILL_SOURCE_LABEL}</span>
                {review.sources[i]}
              </span>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}


/**
 * 건이 둘 이상일 때 **고르는 목록** — 검수 앞에 선다.
 *
 * ## 왜 첫 건을 말없이 쓰지 않나
 *
 * 원가 견적서 한 장에 장비와 구축이 따로 적힌 경우가 흔하다. 첫 건만 집어 들면
 * 사람은 **나머지가 있었다는 사실 자체를 모른다** — 안 들어간 줄은 합계에도 안 나타난다.
 *
 * ## 무엇을 보여 주고 고르게 하나
 *
 * 이름은 문서가 안 줄 때가 많아서 **품목 수와 읽은 금액**을 같이 적는다.
 * 그 둘이 「이게 내가 찾던 그 견적인가」를 가르는 실제 단서다.
 */
export function QuotePickList({ reviews, fileName, hint, onPick }: {
  reviews: FileReview[]
  fileName: string
  /** 이 자리에서 고르면 무엇이 되는지 — 모달과 딜 화면이 서로 다르다 */
  hint: string
  onPick: (index: number) => void
}) {
  return (
    <>
      <div className={styles.reviewHead}>
        <FileText size={16} aria-hidden />
        <b>{fillPickTitle(reviews.length, fileName)}</b>
      </div>
      <p className={styles.sayHint}>{hint}</p>
      <ul className={styles.pickList}>
        {reviews.map((r, i) => (
          <li key={i}>
            <button type="button" className={styles.pickItem} onClick={() => onPick(i)}>
              <b className={styles.pickName}>{fillQuoteName(i, r.label ?? r.title)}</b>
              <span className={styles.pickMeta}>
                <span>{countOnly('product', r.lines.length)}</span>
                <b>{formatAmount(r.total.ourTotalMinor.toString(), r.currency)}</b>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
