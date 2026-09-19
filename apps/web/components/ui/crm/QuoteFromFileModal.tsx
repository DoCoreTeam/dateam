'use client'

// 견적서 파일에서 **견적을 만든다** — 딜 화면의 「파일로 가져오기」
//
// ## 편집 모달의 「파일로 채우기」와 무엇이 다른가
//
// 저쪽은 **보고 있는 견적 하나의 칸을 채운다.** 이쪽은 파일에 든 건마다 **어디로 보낼지**
// 고르고, 고른 대로 견적을 새로 만들거나 있는 견적 뒤에 붙인다.
// 검수 목록은 같은 부품(`quote-review`)을 쓴다 — 한쪽에만 위험 표시가 붙으면
// 검수 없는 쪽으로 틀린 값이 들어간다.
//
// ## 왜 도착지를 묻나
//
// 받은 견적서 한 장이 무엇인지는 우리가 알 수 없다. 원가일 수도 있고, 남의 견적에서
// 항목만 옮겨 오려는 것일 수도 있고, 그냥 참고일 수도 있다. «원가로 보인다»를 우리가
// 판정해 그쪽으로 밀면, 아닌 경우에 사람은 되돌리는 일부터 해야 한다.
// **판정하지 않고 묻는다** (사용자 지시 2026-09-19: "사용자에게 자율성을 줘").
//
// ## AI 는 저장하지 않는다 (§5-3)
//
// 창구는 읽기만 하고 아무것도 만들지 않는다. 여기서 만들기를 누른 것만 견적이 된다.

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Upload } from 'lucide-react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import ErrorState from '@/components/ui/ErrorState'
import { formatAmount } from '@/app/(crm)/crm/deals/amount'
import {
  ACTION, ENTITY, failedTo, progress, QUOTE,
  FILL_FILE_KINDS, FILL_UNCLEAR_TITLE, FILL_NOTHING_FOUND,
  FILL_NO_TABLE, FILL_TRUNCATED, FILL_READ_AS_IMAGE,
  fillQuoteName, fillFoundLine,
  IMPORT_TITLE, IMPORT_FILE_HINT, IMPORT_DEST, IMPORT_DEST_HINT,
  IMPORT_APPEND_TARGET, IMPORT_NO_APPEND_TARGET, IMPORT_OPEN, IMPORT_CLOSE,
  importSubmitLabel, importDoneLine, IMPORT_NOTHING_PICKED,
  IMPORT_COST_HINT, IMPORT_COST_ALSO_QUOTE, IMPORT_COST_ALSO_QUOTE_HINT, IMPORT_COST_ADMIN_ONLY,
  IMPORT_KEEP_FILE, IMPORT_KEEP_FILE_HINT, IMPORT_KEEP_FILE_FAILED,
  type ImportDestKey,
} from '@/lib/terms'
import {
  COST, COST_CATEGORY_LABEL, COST_CATEGORY_ORDER, COST_CATEGORY_HINT,
  COST_STAGE_LABEL, COST_STAGE_ORDER,
  type CostCategory, type CostStage,
} from '@/lib/terms/cost'
import {
  toCostPayloads, withQuoteLineIds,
  INTAKE_DEFAULT_CATEGORY, INTAKE_DEFAULT_STAGE,
  type IntakeLine,
} from '@/lib/crm/domain/quote-cost-intake'
import {
  buildReviews, toggleChecked, pickedIndexes, pickedLines, QuoteReviewList,
  type DocQuoteJson, type FileReview,
} from './quote-review'
import { quoteToDraft, toLinePayload, type QuoteLineDraft } from './quote-draft-shape'
import styles from './quote-panel.module.css'

/** 서버 허용 목록(`quote-from-file.ts` 의 ALLOWED_KINDS)과 같은 범위 */
const ACCEPT = [
  '.pdf', '.xlsx', '.docx', '.pptx', '.hwp', '.hwpx',
  '.odt', '.ods', '.rtf', '.csv', '.txt', '.md',
  '.png', '.jpg', '.jpeg', '.webp',
].join(',')

/** 붙일 수 있는 견적 — **초안만**. 보낸 견적의 항목은 서버가 못 고치게 막는다 */
export interface AppendTarget {
  id: string
  quoteNo: string
  title: string
  status: string
}

/**
 * 도착지 넷의 차례. **원가는 맨 앞이 아니다** — 기본은 늘 새 견적이고,
 * 원가는 고르는 사람이 찾아 누르는 길이다.
 */
const DEST_KEYS = ['new', 'append', 'cost', 'skip'] as const

/** 건 하나를 어디로 보낼지 */
interface Dest {
  key: ImportDestKey
  /** key 가 append 일 때 붙일 견적 */
  targetId: string | null
  /** key 가 cost 일 때만 뜻이 있다 — 원가의 갈래와 시점 */
  category: CostCategory
  stage: CostStage
  /**
   * 같은 건으로 판매 견적도 만들지.
   *
   * **기본은 꺼짐이다.** 원가만 남기려는 사람이 훨씬 많고, 켜면 견적번호가 하나 나간다 —
   * 지우면 그 번호는 비고 다시 쓰이지 않는다. 켠 경우에만 원가 줄과 판매 줄이 이어진다.
   */
  alsoQuote: boolean
}

/** 새 건의 도착지 초기값 — 되돌리기 싼 쪽이 기본값이다 */
const newDest = (): Dest => ({
  key: 'new' as ImportDestKey,
  targetId: null,
  category: INTAKE_DEFAULT_CATEGORY,
  stage: INTAKE_DEFAULT_STAGE,
  alsoQuote: false,
})

interface Props {
  dealId: string
  dealName: string
  dealCurrency: string | null
  /** 이 딜의 초안 견적 — 「있는 견적에 붙이기」가 고를 대상 */
  targets: AppendTarget[]
  onClose: () => void
  /** 하나라도 만들어졌으면 목록을 다시 읽는다 */
  onDone: (message: string) => void
}

/** 파일 한 장에서 읽은 것 중 **건에 딸리지 않은** 값 */
interface DocInfo {
  fileName: string
  route: 'text' | 'vision'
  truncated: boolean
  tableCount: number
  unclear: string[]
}

export default function QuoteFromFileModal({
  dealId, dealName, dealCurrency, targets, onClose, onDone,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [docInfo, setDocInfo] = useState<DocInfo | null>(null)
  const [reviews, setReviews] = useState<FileReview[]>([])
  /** 건마다 도착지 — reviews 와 같은 인덱스 */
  const [dests, setDests] = useState<Dest[]>([])
  /** 펴 놓은 건. **기본은 접힘** — 건이 다섯이면 펴진 목록 다섯이 화면을 덮는다 */
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  /**
   * 원가를 넣을 수 있는 사람인가 — **서버가 답한다.**
   *
   * 화면이 역할을 보고 스스로 판정하면 규칙이 두 곳이 되고, 능력을 사람 단위로 주는 날
   * 화면만 옛 규칙으로 남는다. 못 물어봤으면 **없는 것으로 본다** — 보이지 않는 쪽이 안전하다.
   */
  const [canCost, setCanCost] = useState(false)
  /**
   * 「이 파일도 딜 첨부로 남기기」. **파일 하나에 한 번** 묻는다 — 올린 파일은 한 장이다.
   * 기본은 꺼짐이고, 원가로 보내는 건이 하나라도 있을 때만 화면에 선다.
   */
  const [keepFile, setKeepFile] = useState(false)
  /** 첨부로 남길 때만 쓰는 원본. 안 켜면 아무 데도 안 간다 */
  const [picked, setPicked] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  /*
    창을 열 때 한 번 묻는다. 403 이면 원가 길 자체를 안 그린다 —
    「권한이 없습니다」라고 적어 두면 누를 수 없는 길을 매번 지나쳐야 한다.
  */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch(`/api/crm/deals/${dealId}/costs`, { cache: 'no-store' })
        if (!res.ok) return
        const body = await res.json()
        if (alive) setCanCost(Boolean(body?.canEdit))
      } catch { /* 못 물어봤으면 없는 것으로 본다 */ }
    })()
    return () => { alive = false }
  }, [dealId])

  const readFile = async (file: File) => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/crm/quotes/draft-file', { method: 'POST', body: form })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '파일을 읽지 못했습니다.'); return }

      const made = buildReviews((body.quotes ?? []) as DocQuoteJson[], dealCurrency)
      if (made.length === 0) { setError(FILL_NOTHING_FOUND); return }

      setDocInfo({
        ...(body.source as Omit<DocInfo, 'unclear'>),
        unclear: (body.unclear ?? []) as string[],
      })
      setReviews(made)
      /*
        **기본 도착지는 늘 「새 견적으로」다.**

        읽은 것이 원가인지 우리 견적인지는 우리가 모른다. 모르는 채로 원가 쪽을
        기본값으로 두면, 아닌 경우에 사람은 되돌리는 일부터 해야 한다 —
        새 견적은 초안이라 지우기도 고치기도 쉽다. 되돌리기 싼 쪽이 기본값이다.
      */
      setDests(made.map(() => newDest()))
      setOpenIndex(null)
      setPicked(file)
      setKeepFile(false)
      if (typeof body.switchedNote === 'string') setNote(body.switchedNote)
    } catch {
      setError('파일을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const setDest = (i: number, next: Partial<Dest>) =>
    setDests((ds) => ds.map((d, j) => (j === i ? { ...d, ...next } : d)))

  const toggle = (qi: number, li: number) =>
    setReviews((rs) => rs.map((r, j) => (j === qi ? toggleChecked(r, li) : r)))

  /** 실제로 무언가 될 건 — 도착지를 골랐고 체크된 줄이 하나라도 있는 것 */
  const going = reviews
    .map((r, i) => ({ r, d: dests[i] }))
    .filter(({ r, d }) => d && d.key !== 'skip' && pickedLines(r).length > 0)

  /** 새 견적 하나를 만든다 */
  const createOne = async (review: FileReview, lines: QuoteLineDraft[]) => {
    const res = await fetch('/api/crm/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dealId,
        title: (review.title ?? '').trim() || `${dealName} 견적`,
        /*
          **통화는 읽은 대로 간다.** 딜이 원화라고 달러 견적서를 원화로 눕히면
          숫자가 1,400배 틀린 견적이 조용히 생긴다. 딜과 통화가 다른 견적은
          만들 수 있고(서버도 받는다), 그 사실은 견적 목록에 그대로 보인다.
        */
        currency: review.currency,
        lines: lines.map(toLinePayload),
        /*
          **어느 파일에서 왔는지 남긴다.** 파일 자체는 보관하지 않으므로(§5-3)
          이 이름이 출처에 대해 남는 전부다. 시각은 서버가 찍는다 —
          이 값이 「아직 안 고쳤다」 배지의 근거가 되고, 그래서 바깥이 정하면 안 된다.
        */
        sourceFileName: docInfo?.fileName ?? null,
      }),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error?.message ?? '견적을 만들지 못했습니다.')
    return body as { lines?: { id: string }[] }
  }

  /**
   * 있는 견적 **뒤에** 붙인다.
   *
   * 지금 있는 항목을 먼저 읽어 그대로 실어 보낸다 — 새 줄만 보내면 서버의 syncLines 가
   * 「이번에 안 온 항목」을 지운 것으로 보고 **있던 항목이 사라진다.**
   */
  const appendOne = async (targetId: string, lines: QuoteLineDraft[]) => {
    const got = await fetch(`/api/crm/quotes/${targetId}`, { cache: 'no-store' })
    const cur = await got.json()
    if (!got.ok) throw new Error(cur?.error?.message ?? '붙일 견적을 불러오지 못했습니다.')

    const draft = quoteToDraft(cur)
    const kept = draft.lines.filter((l) => l.name.trim())
    const res = await fetch(`/api/crm/quotes/${targetId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: draft.version,
        sections: draft.sections.map((x) => ({ id: x.id ?? null, name: x.name })),
        lines: [...kept, ...lines].map(toLinePayload),
      }),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error?.message ?? '항목을 붙이지 못했습니다.')
  }

  /**
   * 고른 줄을 **딜 원가**로 넣는다 — 한 건이 한 번의 요청이다.
   *
   * 줄마다 따로 보내면 다섯째 줄에서 실패했을 때 앞의 넷이 남고, 사람은 무엇이 들어갔는지
   * 모른 채 다시 올려 같은 원가를 두 벌 만든다. 서버가 한 트랜잭션으로 받는다.
   */
  const costOne = async (items: ReturnType<typeof toCostPayloads>) => {
    const res = await fetch(`/api/crm/deals/${dealId}/costs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error?.message ?? failedTo(ENTITY.cost.label, '넣지'))
  }

  /**
   * 근거 문서를 딜 첨부로 남긴다 — **켠 경우에만** 부른다.
   *
   * 종류는 매입 견적서(`SUPPLY_QUOTE`)다. 그 종류가 대외비 등급을 정하므로
   * 여기서 등급을 고르지 않는다(`ATTACHMENT_KIND_SENSITIVITY`).
   */
  const attachSource = async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    form.append('target', 'DEAL')
    form.append('targetId', dealId)
    form.append('kind', 'SUPPLY_QUOTE')
    const res = await fetch('/api/crm/attachments', { method: 'POST', body: form })
    if (!res.ok) throw new Error(IMPORT_KEEP_FILE_FAILED)
  }

  const submit = async () => {
    if (going.length === 0) { setError(IMPORT_NOTHING_PICKED); return }
    setBusy(true)
    setError(null)
    let made = 0
    let appended = 0
    let costed = 0
    try {
      /*
        **건마다 따로 보낸다.** 한 번에 묶어 보내는 창구를 새로 만들지 않는 이유는,
        그 창구가 견적 만들기 규칙(번호 매기기·승인 문턱·환율)을 또 알아야 하기 때문이다.
        순서대로 보내므로 앞이 실패하면 뒤는 안 간다 — 부분 실패를 건수로 말하는 일은 I10 에서 한다.
      */
      for (const { r, d } of going) {
        const lines = pickedLines(r)
        if (d.key === 'cost') {
          /*
            **판매 견적을 먼저 만든다.** 줄 id 가 있어야 원가를 그 줄에 이을 수 있다.
            안 켰으면 견적은 안 만들고 원가만 들어간다 — 그때 quoteLineId 는 전부 비어 있다.
          */
          const quoteLineIds = d.alsoQuote
            ? ((await createOne(r, lines)).lines ?? []).map((l) => l.id)
            : []
          if (d.alsoQuote) made += 1

          const source: IntakeLine[] = pickedIndexes(r).map((i) => ({
            name: r.lines[i].name,
            descriptionMd: r.lines[i].descriptionMd,
            // 금액은 **이미 낸 값**을 쓴다 — 검수 화면이 보여 준 그 숫자여야 한다
            amountMinor: r.checks[i].ourAmountMinor.toString(),
            sourceText: r.sources[i],
          }))
          const items = toCostPayloads(
            withQuoteLineIds(source, quoteLineIds),
            { category: d.category, stage: d.stage, fileName: docInfo?.fileName ?? null },
          )
          await costOne(items)
          costed += items.length
        } else if (d.key === 'append' && d.targetId) {
          await appendOne(d.targetId, lines)
          appended += 1
        } else {
          await createOne(r, lines)
          made += 1
        }
      }

      /*
        **파일은 맨 나중에, 켠 경우에만.** 올리다 실패해도 들어간 원가는 되돌리지 않는다 —
        근거 문서는 뒤에 직접 올릴 수 있지만, 지운 원가는 사람이 다시 검수해야 한다.
      */
      let tail = ''
      if (keepFile && costed > 0 && picked) {
        try { await attachSource(picked) } catch { tail = ` ${IMPORT_KEEP_FILE_FAILED}` }
      }
      onDone(`${importDoneLine(made, appended, costed)}${tail}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '가져오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <NbModal
      title={IMPORT_TITLE}
      onClose={onClose}
      maxWidth={760}
      footer={
        <div className={styles.variantFoot}>
          <NbButton variant="ghost" onClick={onClose} disabled={busy}>{ACTION.cancel}</NbButton>
          <NbButton onClick={() => void submit()} disabled={busy || going.length === 0}>
            {busy ? progress('가져오는') : importSubmitLabel(going.length)}
          </NbButton>
        </div>
      }
    >
      <div className={styles.importBody}>
        {error && <ErrorState message={error} />}

        {!docInfo ? (
          <div className={styles.sayBox}>
            <p className={styles.sayHint}>{IMPORT_FILE_HINT}</p>
            <p className={styles.fillKinds}>{FILL_FILE_KINDS}</p>
            {/*
              고르는 창은 **단추가 연다.** 브라우저 기본 파일 입력을 그대로 두면
              테마가 안 먹고 높이가 다른 단추가 하나 더 생긴다(§2-1).
              편집 모달의 「파일로 채우기」와 같은 방식이다 — 같은 성격은 같은 모양이어야 한다(§2-5).
            */}
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void readFile(f)
                // 같은 파일을 다시 고를 수 있어야 한다 — 값이 남아 있으면 change 가 안 뜬다
                e.target.value = ''
              }}
            />
            <div className={styles.sayFoot}>
              <NbButton onClick={() => fileRef.current?.click()} disabled={busy}>
                {busy ? progress('읽는') : <><Upload size={16} /> {QUOTE.fillPick}</>}
              </NbButton>
            </div>
          </div>
        ) : (
          <>
            <p className={styles.sayHint}>{fillFoundLine(
              reviews.reduce((n, r) => n + r.lines.length, 0), docInfo.fileName,
            )}</p>
            {docInfo.route === 'vision' && <p className={styles.sayUnclear}>{FILL_READ_AS_IMAGE}</p>}
            {docInfo.tableCount === 0 && docInfo.route === 'text' && (
              <p className={styles.sayUnclear}>{FILL_NO_TABLE}</p>
            )}
            {docInfo.truncated && <p className={styles.sayUnclear}>{FILL_TRUNCATED}</p>}

            <ul className={styles.importList}>
              {reviews.map((r, i) => {
                const d = dests[i]
                const open = openIndex === i
                return (
                  <li key={i} className={styles.importItem} data-skip={d?.key === 'skip' ? 'on' : undefined}>
                    {/* 건의 얼굴 — 이름·품목 수·금액. 펴지 않아도 어느 건인지 알아야 한다 */}
                    <button
                      type="button"
                      className={styles.importHead}
                      aria-expanded={open}
                      onClick={() => setOpenIndex(open ? null : i)}
                    >
                      {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                      <b className={styles.pickName}>{fillQuoteName(i, r.label ?? r.title)}</b>
                      <span className={styles.pickMeta}>
                        <span>{open ? IMPORT_CLOSE : IMPORT_OPEN}</span>
                        <b>{formatAmount(r.total.ourTotalMinor.toString(), r.currency)}</b>
                      </span>
                    </button>

                    {/*
                      도착지 — 뜻이 다른 넷이라 라디오다(하나만 된다).
                      **원가는 넣을 수 있는 사람에게만 선다** — 판정은 서버가 했고 여기서는 그 답을 쓴다.
                    */}
                    <div className={styles.destRow} role="radiogroup" aria-label={IMPORT_TITLE}>
                      {DEST_KEYS.filter((k) => k !== 'cost' || canCost).map((k) => (
                        <label key={k} className={styles.destPick}>
                          <input
                            type="radio"
                            name={`dest-${i}`}
                            checked={d?.key === k}
                            disabled={k === 'append' && targets.length === 0}
                            onChange={() => setDest(i, {
                              key: k,
                              targetId: k === 'append' ? (d?.targetId ?? targets[0]?.id ?? null) : null,
                            })}
                          />
                          <span>{IMPORT_DEST[k]}</span>
                        </label>
                      ))}
                    </div>
                    <p className={styles.destHint}>
                      {d ? IMPORT_DEST_HINT[d.key] : IMPORT_DEST_HINT.new}
                    </p>

                    {d?.key === 'append' && (
                      targets.length === 0 ? (
                        <p className={styles.sayUnclear}>{IMPORT_NO_APPEND_TARGET}</p>
                      ) : (
                        <div className={styles.destTarget}>
                          <label className="label" htmlFor={`append-${i}`}>{IMPORT_APPEND_TARGET}</label>
                          <select
                            id={`append-${i}`}
                            className="input-field"
                            value={d.targetId ?? ''}
                            onChange={(e) => setDest(i, { targetId: e.target.value || null })}
                          >
                            {targets.map((t) => (
                              <option key={t.id} value={t.id}>{t.quoteNo} · {t.title}</option>
                            ))}
                          </select>
                        </div>
                      )
                    )}

                    {/*
                      **갈래·시점은 원가를 고른 사람에게만 나타난다.**
                      늘 세워 두면 새 견적 하나 만들려던 사람이 안 쓰는 칸 셋을 지나쳐야 하고,
                      지나치는 칸에는 결국 아무 값이나 남는다.
                    */}
                    {d?.key === 'cost' && (
                      <div className={styles.destCost}>
                        <p className={styles.destHint}>{IMPORT_COST_HINT}</p>
                        <div className={styles.destPair}>
                          <div className={styles.destTarget}>
                            <label className="label" htmlFor={`cost-category-${i}`}>{COST.category}</label>
                            <select
                              id={`cost-category-${i}`}
                              className="input-field"
                              value={d.category}
                              onChange={(e) => setDest(i, { category: e.target.value as CostCategory })}
                            >
                              {COST_CATEGORY_ORDER.map((c) => (
                                <option key={c} value={c}>{COST_CATEGORY_LABEL[c]}</option>
                              ))}
                            </select>
                          </div>
                          <div className={styles.destTarget}>
                            <label className="label" htmlFor={`cost-stage-${i}`}>{COST.stage}</label>
                            {/*
                              **기본은 추정이다.** 견적서를 받은 시점에 확정된 것은 아무것도 없다 —
                              확정으로 들어가면 「추정이 얼마나 틀렸나」를 볼 짝이 사라진다.
                            */}
                            <select
                              id={`cost-stage-${i}`}
                              className="input-field"
                              value={d.stage}
                              onChange={(e) => setDest(i, { stage: e.target.value as CostStage })}
                            >
                              {COST_STAGE_ORDER.map((st) => (
                                <option key={st} value={st}>{COST_STAGE_LABEL[st]}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <p className={styles.destHint}>{COST_CATEGORY_HINT[d.category]}</p>
                        <label className={styles.destPick}>
                          <input
                            type="checkbox"
                            checked={d.alsoQuote}
                            onChange={(e) => setDest(i, { alsoQuote: e.target.checked })}
                          />
                          <span>{IMPORT_COST_ALSO_QUOTE}</span>
                        </label>
                        <p className={styles.destHint}>{IMPORT_COST_ALSO_QUOTE_HINT}</p>
                      </div>
                    )}

                    {open && <QuoteReviewList review={r} onToggle={(li) => toggle(i, li)} />}
                  </li>
                )
              })}
            </ul>

            {/*
              **원가를 못 넣는 사람에게도 한 줄은 남긴다.** 도착지에서 원가가 안 보이는 이유가
              「없는 기능」이 아니라 「내 권한이 아님」이라는 것을 알아야 관리자에게 넘길 수 있다.
            */}
            {!canCost && <p className={styles.destHint}>{IMPORT_COST_ADMIN_ONLY}</p>}

            {/*
              근거 문서는 **원가로 보낼 때만** 권한다. 기본은 꺼짐이고, 켠 경우에만 파일이 남는다 —
              그냥 내용만 가져오는 경우까지 남기면 남의 견적서가 우리 저장소에 쌓인다.
            */}
            {dests.some((d) => d?.key === 'cost') && (
              <div className={styles.keepFile}>
                <label className={styles.destPick}>
                  <input
                    type="checkbox"
                    checked={keepFile}
                    onChange={(e) => setKeepFile(e.target.checked)}
                  />
                  <span>{IMPORT_KEEP_FILE}</span>
                </label>
                <p className={styles.destHint}>{IMPORT_KEEP_FILE_HINT}</p>
              </div>
            )}

            {note && <div className={styles.sayNote}>{note}</div>}

            {docInfo.unclear.length > 0 && (
              <div className={styles.sayUnclear}>
                <b>{FILL_UNCLEAR_TITLE}</b>
                <ul>{docInfo.unclear.map((u, i) => <li key={i}>{u}</li>)}</ul>
              </div>
            )}
          </>
        )}
      </div>
    </NbModal>
  )
}
