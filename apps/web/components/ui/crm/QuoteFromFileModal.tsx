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

import { useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Upload } from 'lucide-react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import ErrorState from '@/components/ui/ErrorState'
import { formatAmount } from '@/app/(crm)/crm/deals/amount'
import {
  ACTION, progress, QUOTE,
  FILL_FILE_KINDS, FILL_UNCLEAR_TITLE, FILL_NOTHING_FOUND,
  FILL_NO_TABLE, FILL_TRUNCATED, FILL_READ_AS_IMAGE,
  fillQuoteName, fillFoundLine,
  IMPORT_TITLE, IMPORT_FILE_HINT, IMPORT_DEST, IMPORT_DEST_HINT,
  IMPORT_APPEND_TARGET, IMPORT_NO_APPEND_TARGET, IMPORT_OPEN, IMPORT_CLOSE,
  importSubmitLabel, importDoneLine, IMPORT_NOTHING_PICKED,
  type ImportDestKey,
} from '@/lib/terms'
import {
  buildReviews, toggleChecked, pickedLines, QuoteReviewList,
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

/** 건 하나를 어디로 보낼지 */
interface Dest {
  key: ImportDestKey
  /** key 가 append 일 때 붙일 견적 */
  targetId: string | null
}

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
  const fileRef = useRef<HTMLInputElement>(null)

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
      setDests(made.map(() => ({ key: 'new' as ImportDestKey, targetId: null })))
      setOpenIndex(null)
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

  const submit = async () => {
    if (going.length === 0) { setError(IMPORT_NOTHING_PICKED); return }
    setBusy(true)
    setError(null)
    let made = 0
    let appended = 0
    try {
      /*
        **건마다 따로 보낸다.** 한 번에 묶어 보내는 창구를 새로 만들지 않는 이유는,
        그 창구가 견적 만들기 규칙(번호 매기기·승인 문턱·환율)을 또 알아야 하기 때문이다.
        순서대로 보내므로 앞이 실패하면 뒤는 안 간다 — 부분 실패를 건수로 말하는 일은 I10 에서 한다.
      */
      for (const { r, d } of going) {
        const lines = pickedLines(r)
        if (d.key === 'append' && d.targetId) {
          await appendOne(d.targetId, lines)
          appended += 1
        } else {
          await createOne(r, lines)
          made += 1
        }
      }
      onDone(importDoneLine(made, appended))
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

                    {/* 도착지 — 뜻이 다른 셋이라 라디오다(하나만 된다) */}
                    <div className={styles.destRow} role="radiogroup" aria-label={IMPORT_TITLE}>
                      {(['new', 'append', 'skip'] as const).map((k) => (
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

                    {open && <QuoteReviewList review={r} onToggle={(li) => toggle(i, li)} />}
                  </li>
                )
              })}
            </ul>

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
