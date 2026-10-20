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

import { useEffect, useRef, useState } from 'react'
import { Sparkles, Upload, X, Package } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import { PRICEBOOK } from '@/lib/terms/pricebook'
import {
  ACTION, progress, QUOTE,
  FILL_FILE_HINT, FILL_FILE_KINDS,
  FILL_REVIEW_HINT, FILL_UNCLEAR_TITLE,
  FILL_NO_TABLE, FILL_TRUNCATED, FILL_READ_AS_IMAGE, FILL_NOTHING_FOUND,
  FILL_PICK_BACK, FILL_PICK_ONE_ONLY, FILL_READ_FAILED, FILL_FILE_LABEL,
} from '@/lib/terms'
import { readResponse, describeFetchFailure } from '@/lib/crm/api/read-error'
import {
  buildReviews, toggleChecked, pickedLines, appendLines,
  QuoteReviewList, QuotePickList, ReviewHead, applyDocDuration,
  type DocQuoteJson, type FileReview,
} from './quote-review'
import type { QuoteDraft } from './quote-draft-shape'
import styles from './quote-panel.module.css'
import WaitProgress from '@/components/ui/WaitProgress'
import { quoteWaitProgress } from '@/lib/crm/ui/quote-read-progress'

/** 지금 어느 길을 열어 두었나. null 이면 닫혀 있다 */
export type QuoteFillMode = 'file' | 'product' | null

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

/** 파일 한 장에서 읽은 것 중 **건에 딸리지 않은** 값 */
interface DocInfo {
  fileName: string
  route: 'text' | 'vision'
  truncated: boolean
  tableCount: number
  /** 못 알아본 말 — 건이 아니라 문서에 딸린다 */
  unclear: string[]
}

export interface QuoteFillPanelProps {
  mode: QuoteFillMode
  draft: QuoteDraft
  onDraftChange: (next: (prev: QuoteDraft) => QuoteDraft) => void
  onClose: () => void
  onError: (message: string | null) => void
}

export default function QuoteFillPanel({
  mode, draft, onDraftChange, onClose, onError,
}: QuoteFillPanelProps) {
  const [busy, setBusy] = useState(false)
  /*
    **기다리는 동안 무엇을 하는 중인지 말한다.** 두 창구 상한이 120초와 180초다.
    그 시간 동안 단추가 「읽는 중…」 한 마디만 하면 사람은 고장으로 읽는다
    (사용자 지적 2026-09-20). 옆의 가져오기 창과 **같은 부품·같은 함수**를 쓴다 —
    같은 성격이 화면마다 다른 말을 하면 그게 또 다른 결함이다.
  */
  const [waitPhase, setWaitPhase] = useState<'reading' | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [readingFile, setReadingFile] = useState<{ name: string; size: number } | null>(null)

  /* 1초마다 한 번. 시작 시각이 없으면 아무것도 안 돈다 */
  useEffect(() => {
    if (startedAt === null) return
    setElapsedMs(Date.now() - startedAt)
    const t = setInterval(() => setElapsedMs(Date.now() - startedAt), 1_000)
    return () => clearInterval(t)
  }, [startedAt])
  const [unclear, setUnclear] = useState<string[]>([])
  /** 총액을 맞췄으면 무엇을 얼마로 맞췄는지 — **조용히 단가를 바꾸지 않는다** */
  const [note, setNote] = useState<string | null>(null)
  /**
   * 파일에서 읽은 건 **전부**.
   *
   * 첫 건만 들고 나머지를 버리면 「다른 건 고르기」가 다시 읽기(=AI 를 또 부르기)가 된다.
   * 한 번 읽은 것을 들고 있으면 고르는 일이 공짜가 되고, 사람은 마음껏 오간다.
   */
  const [reviews, setReviews] = useState<FileReview[]>([])
  /** 지금 검수 중인 건. null 이면 아직 안 골랐다 */
  const [pickedIndex, setPickedIndex] = useState<number | null>(null)
  /** 건에 딸리지 않은 값은 따로 든다 — 건이 여럿이어도 파일은 한 장이다 */
  const [docInfo, setDocInfo] = useState<DocInfo | null>(null)
  const review: FileReview | null = pickedIndex === null ? null : reviews[pickedIndex] ?? null
  const fileRef = useRef<HTMLInputElement>(null)

  const close = () => {
    setReviews([])
    setPickedIndex(null)
    setDocInfo(null)
    onClose()
  }

  /* ── 파일로 채우기 ───────────────────────────── */

  const readFile = async (file: File) => {
    setBusy(true)
    setWaitPhase('reading')
    setReadingFile({ name: file.name, size: file.size })
    setStartedAt(Date.now())
    onError(null)
    setUnclear([])
    setNote(null)
    setReviews([])
    setPickedIndex(null)
    setDocInfo(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/crm/quotes/draft-file', { method: 'POST', body: form })
      const got = await readResponse(res, FILL_READ_FAILED)
      if (!got.ok) { onError(got.message); return }
      const body = (got.body ?? {}) as Record<string, unknown>

      /*
        응답은 **건 목록**이다. 한 장에 견적이 둘이면 둘로 온다.

        여기(편집 모달)는 지금 보고 있는 견적 하나를 채우는 자리다. 그래도 첫 건을
        말없이 집지 않는다 — 원가 견적서 한 장에 장비와 구축이 따로 적힌 경우가 흔하고,
        그때 사람은 **나머지가 있었다는 사실 자체를 모른 채** 한쪽만 넣게 된다.
        건이 하나면 고를 것이 없으니 곧장 검수로 간다.
      */
      const quotes = (body.quotes ?? []) as DocQuoteJson[]
      const source = body.source as Omit<DocInfo, 'unclear'>
      // 갈아탄 사실은 검수 목록과 **함께** 보인다 — 나중에 따로 말하면 이미 넣은 뒤다
      if (typeof body.switchedNote === 'string') setNote(body.switchedNote)

      const made = buildReviews(quotes, draft.currency)
      if (made.length === 0) {
        onError(FILL_NOTHING_FOUND)
        setUnclear((body.unclear ?? []) as string[])
        return
      }

      // 못 알아본 말은 **넣은 뒤에** 보여 준다 — 검수 중에 띄우면 목록이 밀린다
      setDocInfo({ ...source, unclear: (body.unclear ?? []) as string[] })
      setReviews(made)
      setPickedIndex(made.length === 1 ? 0 : null)
    } catch {
      onError(describeFetchFailure(FILL_FILE_LABEL))
    } finally {
      setBusy(false)
      setWaitPhase(null)
      setStartedAt(null)
      // 같은 파일을 다시 고를 수 있어야 한다 — 값이 남아 있으면 change 가 안 뜬다
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const applyReview = () => {
    if (!review) return
    const picked = pickedLines(review)
    if (picked.length === 0) return
    onDraftChange((prev) => ({
      ...prev,
      title: prev.title.trim() ? prev.title : (review.title ?? prev.title),
      lines: appendLines(prev, picked),
    }))
    setUnclear(docInfo?.unclear ?? [])
    setReviews([])
    setPickedIndex(null)
    setDocInfo(null)
    onClose()
  }

  /** 체크는 **지금 보고 있는 건**에만 든다 — 다른 건의 체크 상태는 그대로 남는다 */
  const toggle = (i: number) => setReviews((rs) => rs.map(
    (r, j) => (j === pickedIndex ? toggleChecked(r, i) : r),
  ))

  /** 문서 전체 기간을 **기간이 빈 줄에만** 내린다. 사람이 누를 때만 돈다 */
  const applyDuration = () => setReviews((rs) => rs.map(
    (r, j) => (j === pickedIndex ? applyDocDuration(r) : r),
  ))

  const pickedCount = review ? review.checked.filter(Boolean).length : 0

  return (
    <>
      {/*
        진행 표시는 모드 분기 **밖**이다. 안에 두면 부품이 두 벌이 되고,
        한쪽만 고치는 날 나머지 한쪽이 다시 침묵한다.
      */}
      {waitPhase && (() => {
        const w = quoteWaitProgress({
          phase: waitPhase,
          elapsedMs,
          fileName: readingFile?.name ?? '',
          fileBytes: readingFile?.size ?? 0,
        })
        return <WaitProgress message={w.message} elapsedLabel={w.elapsedLabel} reassure={w.reassure} />
      })()}

      {mode === 'file' && !docInfo && (
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
        **건이 둘 이상이면 고르는 일이 먼저다.** 하나면 이 자리는 아예 안 뜬다 —
        고를 것이 없는데 고르라고 하면 누르는 수고만 는다.
      */}
      {docInfo && !review && reviews.length > 0 && (
        <div className={styles.reviewBox}>
          <QuotePickList
            reviews={reviews}
            fileName={docInfo.fileName}
            hint={FILL_PICK_ONE_ONLY}
            onPick={setPickedIndex}
          />
          <div className={styles.sayFoot}>
            <NbButton variant="ghost" onClick={close} disabled={busy}>{ACTION.cancel}</NbButton>
          </div>
        </div>
      )}

      {/*
        **넣기 전에 본다.** 체크한 것만 폼에 들어간다(§5-3 추출/제안형 — 자동 등록 금지).
        줄마다 원문 조각을 옆에 둬서, 사람이 숫자를 원문과 견줄 수 있게 한다.
      */}
      {review && docInfo && (
        <div className={styles.reviewBox}>
          <ReviewHead review={review} fileName={docInfo.fileName} />
          <p className={styles.sayHint}>{FILL_REVIEW_HINT}</p>

          {docInfo.route === 'vision' && <p className={styles.sayUnclear}>{FILL_READ_AS_IMAGE}</p>}
          {docInfo.tableCount === 0 && docInfo.route === 'text' && (
            <p className={styles.sayUnclear}>{FILL_NO_TABLE}</p>
          )}
          {docInfo.truncated && <p className={styles.sayUnclear}>{FILL_TRUNCATED}</p>}

          <QuoteReviewList review={review} onToggle={toggle} onApplyDuration={applyDuration} />

          <div className={styles.sayFoot}>
            {/* 고른 것을 되돌릴 수 있어야 한다 — 골라 보기 전에는 어느 건인지 알 수 없다 */}
            {reviews.length > 1 && (
              <NbButton variant="ghost" onClick={() => setPickedIndex(null)} disabled={busy}>
                {FILL_PICK_BACK}
              </NbButton>
            )}
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
/** 늘 열린 말로 채우기 글 상자로 — 보이게 굴리고 글자 끝에 커서를 둔다 */
function focusTextEditor(): void {
  const el = document.getElementById('quote-text-fill') as HTMLTextAreaElement | null
  if (!el) return
  el.scrollIntoView({ block: 'center' })
  el.focus()
  el.setSelectionRange(el.value.length, el.value.length)
}

export function QuoteFillButtons({ mode, onMode }: {
  mode: QuoteFillMode
  onMode: (next: QuoteFillMode) => void
}) {
  return (
    <>
      {/* 말로 채우기는 표 위에 늘 열려 있다 — 단추는 그 글 상자로 데려간다 */}
      <NbButton variant="ghost" onClick={focusTextEditor}>
        <Sparkles size={16} /> {QUOTE.fillBySpeech}
      </NbButton>
      <NbButton
        variant="ghost"
        aria-expanded={mode === 'file'}
        onClick={() => onMode(mode === 'file' ? null : 'file')}
      >
        <Upload size={16} /> {QUOTE.fillByFile}
      </NbButton>
      {/* 가격 기준의 제품과 조건으로 — AI 를 안 부른다. 계산은 견적 저장과 같은 엔진이다 */}
      <NbButton
        variant="ghost"
        aria-expanded={mode === 'product'}
        onClick={() => onMode(mode === 'product' ? null : 'product')}
      >
        <Package size={16} /> {PRICEBOOK.fillByProduct}
      </NbButton>
    </>
  )
}
