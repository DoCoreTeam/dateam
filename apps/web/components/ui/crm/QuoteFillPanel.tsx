'use client'

// 견적 항목 **채우기** — 말로 적거나, 이미 만들어 둔 견적서 파일을 올린다.
//
// ## 왜 편집 모달에서 떼어 냈나
//
// 모달이 1,100줄을 넘었고 그 안에서 «폼을 그리는 일»과 «폼을 채우는 일»이 섞여 있었다.
// 채우기는 그 자체로 한 덩어리다 — 창구를 부르고, 읽은 것을 보여 주고, 사람이 고른 것만 넣는다.
//
// ## 두 길이 같은 문을 지난다
//
// 말로 적든 파일을 올리든 **폼에 들어가는 방식은 같다**: 사람이 보고, 체크하고, 넣는다.
// 길마다 다르게 만들면 한쪽에만 검수가 붙고, 검수 없는 쪽으로 틀린 값이 들어온다.
//
// ## AI 는 저장하지 않는다 (§5-3)
//
// 여기서 하는 일은 **폼을 채우는 것까지**다. 저장은 사람이 누른다.
// 견적은 고객에게 나가는 문서이고, AI 가 단가를 하나 잘못 풀면 그 숫자가 그대로 제안가가 된다.

import { useRef, useState } from 'react'
import { Sparkles, Upload, FileText, X } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import { scaleLinesToTarget, describeScale } from '@/lib/crm/domain/quote-target'
import {
  checkLine, checkTotal, initialChecked,
  type LineCheck, type LineCheckInput, type TotalCheck,
} from '@/lib/crm/domain/quote-reconcile'
import { formatAmount } from '@/app/(crm)/crm/deals/amount'
import { LINE_KIND_ORDER, LINE_KIND_UNIT, type QuoteLineKind } from '@/lib/terms/cost'
import {
  ACTION, progress, QUOTE,
  FILL_SPEECH_HINT, FILL_SPEECH_PLACEHOLDER, FILL_FILE_HINT, FILL_FILE_KINDS,
  FILL_REVIEW_HINT, FILL_UNCLEAR_TITLE, FILL_NO_PRICE, FILL_SOURCE_LABEL,
  FILL_NO_TABLE, FILL_TRUNCATED, FILL_READ_AS_IMAGE, FILL_NOTHING_FOUND, fillFoundLine,
  FILL_RISK_TEXT, FILL_TOTAL_MATCH, FILL_TOTAL_NO_REFERENCE, fillTotalMismatch,
  FILL_TOTAL_OURS, FILL_TOTAL_DOCUMENT,
} from '@/lib/terms'
import type { QuoteDraft, QuoteLineDraft } from './quote-draft-shape'
import styles from './quote-panel.module.css'

/** 지금 어느 길을 열어 두었나. null 이면 닫혀 있다 */
export type QuoteFillMode = 'speech' | 'file' | null

/**
 * 파일 고르기가 받는 확장자.
 *
 * 「모든 파일」로 열어 두지 않는다 — 안 되는 것을 골라 올리고 기다린 뒤에
 * 「이 형식은 안 됩니다」를 듣는 것은 시간을 두 번 쓰는 것이다.
 * 서버 허용 목록(`quote-from-file.ts` 의 ALLOWED_KINDS)과 같은 범위다.
 */
const ACCEPT = [
  '.pdf', '.xlsx', '.docx', '.pptx', '.hwp', '.hwpx',
  '.odt', '.ods', '.rtf', '.csv', '.txt', '.md',
  '.png', '.jpg', '.jpeg', '.webp',
].join(',')

/** 창구가 돌려주는 항목 한 줄 */
interface DocLineJson {
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

/** 파일에서 읽은 것을 사람이 보는 동안 들고 있는 값 */
interface Review {
  fileName: string
  route: 'text' | 'vision'
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
  title: string | null
  unclear: string[]
  truncated: boolean
  tableCount: number
}

export interface QuoteFillPanelProps {
  mode: QuoteFillMode
  draft: QuoteDraft
  onDraftChange: (next: (prev: QuoteDraft) => QuoteDraft) => void
  onClose: () => void
  onError: (message: string | null) => void
}

/** 창구가 준 줄을 폼 모양으로. 두 길이 같은 함수를 쓴다 */
function toFormLine(l: DocLineJson, taxPercent: number | null): QuoteLineDraft {
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
 * 읽은 항목을 폼에 **얹는다** — 지금 있는 항목을 지우지 않고 뒤에 붙인다.
 *
 * 빈 줄 하나뿐일 때만 갈아 끼운다. 새 견적의 그 한 줄은 «아직 아무것도 안 적은 상태»이고,
 * 거기에 이어 붙이면 이름 없는 0원 줄이 견적서 맨 위에 남는다.
 */
function appendLines(prev: QuoteDraft, made: QuoteLineDraft[]): QuoteLineDraft[] {
  if (made.length === 0) return prev.lines
  const onlyEmpty = prev.lines.length === 1 && !prev.lines[0].name.trim()
  return onlyEmpty ? made : [...prev.lines, ...made]
}

export default function QuoteFillPanel({
  mode, draft, onDraftChange, onClose, onError,
}: QuoteFillPanelProps) {
  const [sayText, setSayText] = useState('')
  const [busy, setBusy] = useState(false)
  const [unclear, setUnclear] = useState<string[]>([])
  /** 총액을 맞췄으면 무엇을 얼마로 맞췄는지 — **조용히 단가를 바꾸지 않는다** */
  const [note, setNote] = useState<string | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const close = () => {
    setSayText('')
    setReview(null)
    onClose()
  }

  /** 지금 폼에 있는 항목 — 「총액 3억에 맞춰서」가 가리키는 대상 */
  const currentLines = () => draft.lines
    .filter((l) => l.name.trim())
    .map((l) => ({
      name: l.name, quantity: l.quantity, unit: l.unit,
      unitPriceMinor: l.unitPriceMinor,
      discountPercent: l.discountPercent, taxRate: l.taxRate,
    }))

  /* ── 말로 채우기 ─────────────────────────────── */

  const applySaid = async () => {
    if (!sayText.trim()) return
    setBusy(true)
    onError(null)
    setUnclear([])
    setNote(null)
    try {
      const res = await fetch('/api/crm/quotes/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sayText.trim(), currentLines: currentLines() }),
      })
      const body = await res.json()
      if (!res.ok) { onError(body?.error?.message ?? '읽지 못했습니다.'); return }
      /*
        **고른 모델이 막혀 다른 것이 답했으면 그 사실을 말한다.**
        비용과 품질이 달라지는 일이라 모르고 지나가면 안 된다 — 같은 입력에 다른 답이
        나온 이유를 사람이 설명할 수 있어야 한다.
      */
      const switched = typeof body.switchedNote === 'string' ? body.switchedNote : null
      const d = (body.draft ?? body) as {
        title: string | null
        lines: DocLineJson[]
        roundingUnit: number
        targetTotalMinor: number | null
        targetIncludesTax: boolean
        taxPercent: number | null
        unclear: string[]
      }
      const made = (d.lines ?? []).filter((l) => l.name).map((l) => toFormLine(l, null))

      /*
        새 항목이 없어도 **목표만으로 성립한다** — 「지금 이대로 3억에 맞춰 줘」가 그 경우다.
      */
      const hasTarget = typeof d.targetTotalMinor === 'number' && d.targetTotalMinor > 0
      if (made.length === 0 && !hasTarget) {
        onError('견적 항목을 찾지 못했어요. 품목과 수량이 들어가게 적어 주세요.')
        return
      }

      /*
        **계산을 업데이터 밖에서 한다**(v0.7.695 정정). 업데이터는 순수해야 하고
        React 가 두 번 부를 수 있어, 그 안에서 바깥 변수에 대입하면 화면에 닿지 않는다 —
        총액은 맞춰졌는데 「맞췄어요」가 안 떴다(실브라우저에서 잡힘).
      */
      const roundingUnit = d.roundingUnit || draft.roundingUnit
      const intent = hasTarget
        ? { totalMinor: d.targetTotalMinor as number, includesTax: Boolean(d.targetIncludesTax) }
        : null

      /**
       * **목표 총액은 우리가 맞춘다 — AI 가 아니라.**
       * 계산은 `quote-target.ts`(SSOT · 가드 12개)가 하고 여기서는 결과만 얹는다.
       * 단가만 갈아 끼운다 — 품목·규격·묶음은 사람이 정한 그대로 둔다.
       */
      const scale = (lines: QuoteLineDraft[]) => {
        if (!intent) return { lines, note: null as string | null }
        const r = scaleLinesToTarget(
          lines.map((l) => ({
            kind: l.kind, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor,
            discountPercent: l.discountPercent, specialDiscountPercent: l.specialDiscountPercent,
            taxRate: l.taxRate,
          })),
          intent,
          { unit: roundingUnit as 0, mode: 'DOWN' },
        )
        const note = describeScale(intent, r, roundingUnit)
        if (r.reason !== null) return { lines, note }
        return {
          lines: lines.map((l, i) => ({
            ...l, unitPriceMinor: String(r.lines[i]?.unitPriceMinor ?? l.unitPriceMinor),
          })),
          note,
        }
      }

      /*
        **폼은 최신 상태 위에 얹는다**(updater 로). 기다리는 동안 사용자가 칸을 고쳤을 수 있고,
        그 손질을 AI 결과가 덮으면 사람은 자기가 방금 쓴 값이 사라진 것을 본다.

        **알림 문구는 updater 밖에서 만든다**(v0.7.695 정정). updater 는 순수해야 하고
        React 가 두 번 부를 수 있어, 그 안에서 바깥 변수에 대입하면 화면에 닿지 않는다 —
        총액은 맞춰졌는데 「맞췄어요」가 안 떴다(실브라우저에서 잡힘).
      */
      onDraftChange((prev) => ({
        ...prev,
        // 제목은 **비어 있을 때만** 채운다 — 사람이 적은 제목을 AI 가 덮으면 안 된다
        title: prev.title.trim() ? prev.title : (d.title ?? prev.title),
        roundingUnit,
        lines: scale(appendLines(prev, made)).lines,
      }))
      setNote([switched, scale(appendLines(draft, made)).note].filter(Boolean).join('\n') || null)
      // **못 알아본 말은 버리지 않는다** — 사람이 직접 넣을 수 있게 그대로 보여 준다
      setUnclear(d.unclear ?? [])
      setSayText('')
      onClose()
    } catch {
      onError('읽지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  /* ── 파일로 채우기 ───────────────────────────── */

  const readFile = async (file: File) => {
    setBusy(true)
    onError(null)
    setUnclear([])
    setNote(null)
    setReview(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/crm/quotes/draft-file', { method: 'POST', body: form })
      const body = await res.json()
      if (!res.ok) { onError(body?.error?.message ?? '파일을 읽지 못했습니다.'); return }

      const d = body.draft as {
        title: string | null
        currency: string | null
        lines: DocLineJson[]
        taxPercent: number | null
        sourceTotalMinor: number | null
        sourceTotalIncludesTax: boolean
        unclear: string[]
      }
      const source = body.source as {
        fileName: string; route: 'text' | 'vision'; truncated: boolean; tableCount: number
      }
      // 갈아탄 사실은 검수 목록과 **함께** 보인다 — 나중에 따로 말하면 이미 넣은 뒤다
      if (typeof body.switchedNote === 'string') setNote(body.switchedNote)
      const usable = (d.lines ?? []).filter((l) => l.name)
      if (usable.length === 0) {
        onError(FILL_NOTHING_FOUND)
        setUnclear(d.unclear ?? [])
        return
      }
      const lines = usable.map((l) => toFormLine(l, d.taxPercent))
      const sources = usable.map((l) => l.sourceText ?? '')

      /*
        **읽은 값을 원문과 맞춰 본다.** 견적서에는 줄마다 금액이 적혀 있고 맨 아래 합계가 있다 —
        즉 답이 문서 안에 이미 있다. 그 둘과 우리 계산을 견주면 잘못 읽은 줄이 스스로 드러난다.
        계산은 `quote-reconcile`(순수 · 가드 20개)이 하고 여기서는 결과만 그린다.
      */
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

      setReview({
        fileName: source.fileName,
        route: source.route,
        lines,
        sources,
        checks,
        // **위험 신호가 붙은 줄은 꺼 둔다** — 켜는 행동 자체가 「내가 봤다」는 뜻이 되게
        checked: initialChecked(checks),
        total: checkTotal({
          lines: inputs,
          documentTotalMinor: d.sourceTotalMinor,
          documentIncludesTax: Boolean(d.sourceTotalIncludesTax),
        }),
        currency: (d.currency ?? draft.currency ?? 'KRW').toUpperCase(),
        title: d.title,
        unclear: d.unclear ?? [],
        truncated: source.truncated,
        tableCount: source.tableCount,
      })
    } catch {
      onError('파일을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
      // 같은 파일을 다시 고를 수 있어야 한다 — 값이 남아 있으면 change 가 안 뜬다
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const applyReview = () => {
    if (!review) return
    const picked = review.lines.filter((_, i) => review.checked[i])
    if (picked.length === 0) return
    onDraftChange((prev) => ({
      ...prev,
      title: prev.title.trim() ? prev.title : (review.title ?? prev.title),
      lines: appendLines(prev, picked),
    }))
    setUnclear(review.unclear)
    setReview(null)
    onClose()
  }

  const toggle = (i: number) => setReview((r) => (r
    ? { ...r, checked: r.checked.map((c, j) => (j === i ? !c : c)) }
    : r))

  const pickedCount = review ? review.checked.filter(Boolean).length : 0

  /**
   * 합계 대조를 **한 문장으로**.
   *
   * JSX 안에서 갈래를 세 번 치면 `diffMinor !== null` 이 안쪽까지 안 따라가고,
   * 무엇보다 읽는 사람이 세 갈래를 눈으로 합쳐야 한다.
   */
  const totalWord = ((): string => {
    if (!review) return ''
    const t = review.total
    if (t.verdict === 'match') return FILL_TOTAL_MATCH
    if (t.verdict === 'no_reference') return FILL_TOTAL_NO_REFERENCE
    const diff = t.diffMinor ?? BigInt(0)
    const short = diff < BigInt(0)
    // formatAmount 는 못 만들면 null 을 준다. 그때 「 원 차이」라고 쓰면 빈칸이 인쇄된다
    const text = formatAmount((short ? -diff : diff).toString(), review.currency)
      ?? (short ? -diff : diff).toString()
    return fillTotalMismatch(text, short)
  })()

  return (
    <>
      {mode === 'speech' && (
        <div className={styles.sayBox}>
          <p className={styles.sayHint}>{FILL_SPEECH_HINT}</p>
          <textarea
            className="input-field"
            rows={3}
            value={sayText}
            autoFocus
            placeholder={FILL_SPEECH_PLACEHOLDER}
            onChange={(e) => setSayText(e.target.value)}
          />
          <div className={styles.sayFoot}>
            <NbButton variant="ghost" onClick={close} disabled={busy}>{ACTION.cancel}</NbButton>
            <NbButton onClick={() => void applySaid()} disabled={busy || !sayText.trim()}>
              {busy ? progress('읽는') : QUOTE.fillFromSpeech}
            </NbButton>
          </div>
        </div>
      )}

      {mode === 'file' && !review && (
        <div className={styles.sayBox}>
          <p className={styles.sayHint}>{FILL_FILE_HINT}</p>
          {/*
            고르는 창은 **단추가 연다.** 브라우저 기본 파일 입력을 그대로 두면
            테마가 안 먹고 높이가 다른 단추가 하나 더 생긴다(§2-1).
          */}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void readFile(f)
            }}
          />
          <p className={styles.fillKinds}>{FILL_FILE_KINDS}</p>
          <div className={styles.sayFoot}>
            <NbButton variant="ghost" onClick={close} disabled={busy}>{ACTION.cancel}</NbButton>
            <NbButton onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? progress('읽는') : <><Upload size={16} /> {QUOTE.fillPick}</>}
            </NbButton>
          </div>
        </div>
      )}

      {/*
        **넣기 전에 본다.** 체크한 것만 폼에 들어간다(§5-3 추출/제안형 — 자동 등록 금지).
        줄마다 원문 조각을 옆에 둬서, 사람이 숫자를 원문과 견줄 수 있게 한다.
      */}
      {review && (
        <div className={styles.reviewBox}>
          <div className={styles.reviewHead}>
            <FileText size={16} aria-hidden />
            <b>{fillFoundLine(review.lines.length, review.fileName)}</b>
          </div>
          <p className={styles.sayHint}>{FILL_REVIEW_HINT}</p>

          {review.route === 'vision' && <p className={styles.sayUnclear}>{FILL_READ_AS_IMAGE}</p>}
          {review.tableCount === 0 && review.route === 'text' && (
            <p className={styles.sayUnclear}>{FILL_NO_TABLE}</p>
          )}
          {review.truncated && <p className={styles.sayUnclear}>{FILL_TRUNCATED}</p>}

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
            <span className={styles.totalCheckWord}>{totalWord}</span>
          </div>

          <ul className={styles.reviewList}>
            {review.lines.map((l, i) => (
              <li key={i} className={styles.reviewItem} data-risk={review.checks[i].safe ? undefined : 'on'}>
                <label className={styles.reviewPick}>
                  <input
                    type="checkbox"
                    checked={review.checked[i]}
                    onChange={() => toggle(i)}
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

          <div className={styles.sayFoot}>
            <NbButton variant="ghost" onClick={close} disabled={busy}>{ACTION.cancel}</NbButton>
            <NbButton onClick={applyReview} disabled={pickedCount === 0}>
              {QUOTE.fillApply} ({pickedCount})
            </NbButton>
          </div>
        </div>
      )}

      {/*
        **총액을 맞췄으면 말한다**(v0.7.695). 단가가 말없이 바뀌면 사람은 그 숫자를 못 믿는다.
      */}
      {note && <div className={styles.sayNote}>{note}</div>}

      {/* 못 알아본 말은 **버리지 않는다** — 사람이 직접 넣을 수 있게 그대로 보여 준다 */}
      {unclear.length > 0 && (
        <div className={styles.sayUnclear}>
          <b>{FILL_UNCLEAR_TITLE}</b>
          <ul>{unclear.map((u, i) => <li key={i}>{u}</li>)}</ul>
          <button type="button" className={styles.sayUnclearClose} aria-label={ACTION.close}
            onClick={() => setUnclear([])}>
            <X size={14} />
          </button>
        </div>
      )}
    </>
  )
}

/**
 * 채우기 단추 둘 — 항목 머리 줄에 선다.
 *
 * 패널과 한 파일에 둔 이유: 단추와 상자가 **같은 상태를 본다.**
 * 파일을 나누면 「어느 것이 열려 있나」를 두 곳이 알아야 하고, 그때부터 갈린다.
 */
export function QuoteFillButtons({ mode, onMode }: {
  mode: QuoteFillMode
  onMode: (next: QuoteFillMode) => void
}) {
  return (
    <>
      <NbButton
        variant="ghost"
        aria-expanded={mode === 'speech'}
        onClick={() => onMode(mode === 'speech' ? null : 'speech')}
      >
        <Sparkles size={16} /> {QUOTE.fillBySpeech}
      </NbButton>
      <NbButton
        variant="ghost"
        aria-expanded={mode === 'file'}
        onClick={() => onMode(mode === 'file' ? null : 'file')}
      >
        <Upload size={16} /> {QUOTE.fillByFile}
      </NbButton>
    </>
  )
}
