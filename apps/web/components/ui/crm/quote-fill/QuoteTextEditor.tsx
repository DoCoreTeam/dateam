'use client'

// 말로 채우기 — 견적 표 위에 늘 열려 있는 글 상자.
//
// 쓰다가 3초 멈추면 표가 고쳐진다. 줄을 더하고, 고치고, 지운다. 글은 견적과 함께 저장된다.
// 규칙이 먼저 읽고 못 읽은 줄만 AI 에게 간다(서버 `quote-text-fill`). 계산은 서버의 엔진이 한다.
// 사람이 표에서 고친 칸은 덮지 않는다.
//
// 글은 plain text 다(정책 5-1). 줄 단위로 표 항목과 짝을 짓기 때문이다 —
// 커서가 선 줄의 항목이 표에 표시되고, 표의 「글 N째 줄」을 누르면 이 상자가 그 줄을 고른다.

import { useCallback, useEffect, useRef, useState } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import WaitProgress from '@/components/ui/WaitProgress'
import { quoteWaitProgress } from '@/lib/crm/ui/quote-read-progress'
import { QUOTE, TEXT_FILL, progress } from '@/lib/terms'
import { kindFromDomain, type CompanyKind } from '@/lib/crm/domain/company-kind'
import { readResponse } from '@/lib/crm/api/read-error'
import type { QuoteDraft } from '../quote-draft-shape'
import { applyReviewFixes, applyTextFill, fromLinesOf, toClientLines, type ReviewJson, type TextFillJson } from './text-fill-apply'
import { textLink, useTextLink } from './text-link-store'
import styles from './quote-fill.module.css'

/** 쓰다가 이만큼 멈추면 정리한다. 글자마다 부르지 않는다 */
export const PAUSE_MS = 3_000

type Status =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; changed: number; res: TextFillJson }
  | { kind: 'failed'; message: string }

interface Props {
  dealId: string
  draft: QuoteDraft
  onDraftChange: (fn: (prev: QuoteDraft) => QuoteDraft) => void
  disabled?: boolean
}

function lineAt(text: string, pos: number): number {
  return text.slice(0, pos).split('\n').length - 1
}

/** 누른 뒤 흐른 시간 — 1초마다. 기다리지 않으면 안 돈다 */
function useElapsed(waiting: boolean): number {
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => { setStartedAt(waiting ? Date.now() : null) }, [waiting])
  useEffect(() => {
    if (startedAt === null) return
    setElapsed(0)
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 1_000)
    return () => clearInterval(t)
  }, [startedAt])
  return startedAt === null ? 0 : elapsed
}

function useCompanyKind(dealId: string): CompanyKind | null {
  const [kind, setKind] = useState<CompanyKind | null>(null)
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const deal = await (await fetch(`/api/crm/deals/${dealId}`)).json()
        if (!deal?.companyId) return
        const company = await (await fetch(`/api/crm/companies/${deal.companyId}`)).json()
        const guess = kindFromDomain(company?.domain ?? null)
        if (alive && guess) setKind(guess.kind)
      } catch { /* 기관 종류를 못 읽어도 글로 채우기는 된다 */ }
    })()
    return () => { alive = false }
  }, [dealId])
  return kind
}

export default function QuoteTextEditor({ dealId, draft, onDraftChange, disabled }: Props) {
  const text = draft.fillText ?? ''
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const companyKind = useCompanyKind(dealId)
  const area = useRef<HTMLTextAreaElement>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const lastSent = useRef<string | null>(text.trim() === '' ? '' : text)
  const aiCache = useRef<TextFillJson['aiCache']>(null)
  const seq = useRef(0)
  const { reveal, active } = useTextLink()
  const [review, setReview] = useState<{ busy: boolean; res: ReviewJson | null; error: string | null }>({ busy: false, res: null, error: null })

  // 「AI로 한 번 더 보기」 — 사람이 누를 때만. 글과 표가 어긋난 곳을 찾아 수량과 이름만 고친다
  const runReview = async () => {
    setReview({ busy: true, res: null, error: null })
    try {
      const res = await fetch('/api/crm/quotes/text-fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: draftRef.current.fillText ?? '', lines: toClientLines(draftRef.current), mode: 'review' }),
      })
      const r = await readResponse(res, TEXT_FILL.failed)
      if (!r.ok) { setReview({ busy: false, res: null, error: r.message ?? TEXT_FILL.failed }); return }
      const body = r.body as ReviewJson
      const next = applyReviewFixes(draftRef.current, body)
      onDraftChange(() => next)
      setReview({ busy: false, res: body, error: null })
    } catch {
      setReview({ busy: false, res: null, error: TEXT_FILL.failed })
    }
  }

  const run = useCallback(async (force: boolean) => {
    const now = draftRef.current.fillText ?? ''
    if (!force && now === lastSent.current) return
    lastSent.current = now
    const mine = ++seq.current
    setStatus({ kind: 'working' })
    try {
      const res = await fetch('/api/crm/quotes/text-fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: now, lines: toClientLines(draftRef.current), companyKind, ai: 'auto', aiCache: aiCache.current }),
      })
      const r = await readResponse(res, TEXT_FILL.failed)
      if (mine !== seq.current) return
      if (!r.ok) { setStatus({ kind: 'failed', message: r.message ?? TEXT_FILL.failed }); return }
      const body = r.body as TextFillJson
      if (body.aiCache) aiCache.current = body.aiCache
      // 응답이 온 그때의 초안에 얹는다 — 기다리는 동안 사람이 고친 칸도 그대로 간다
      const applied = applyTextFill(draftRef.current, body, now)
      onDraftChange(() => applied.draft)
      setStatus({ kind: 'done', changed: applied.changed, res: body })
    } catch {
      if (mine === seq.current) setStatus({ kind: 'failed', message: TEXT_FILL.failed })
    }
  }, [companyKind, onDraftChange])

  // 멈추면 정리 — 글이 바뀔 때마다 시계를 다시 건다
  useEffect(() => {
    if (disabled || text === lastSent.current) return
    const t = setTimeout(() => { void run(false) }, PAUSE_MS)
    return () => clearTimeout(t)
  }, [text, disabled, run])

  // 표의 「글 N째 줄」을 누르면 그 줄을 고른다
  useEffect(() => {
    const el = area.current
    if (!reveal || !el) return
    const lines = el.value.split('\n')
    const start = lines.slice(0, reveal.line).reduce((n, l) => n + l.length + 1, 0)
    el.focus()
    el.setSelectionRange(start, start + (lines[reveal.line]?.length ?? 0))
  }, [reveal])

  useEffect(() => () => textLink.reset(), [])

  const onCaret = () => {
    const el = area.current
    if (el) textLink.setActive(lineAt(el.value, el.selectionStart))
  }

  const linked = active === null ? 0 : draft.lines.filter((l) => fromLinesOf(l).includes(active)).length
  const res = status.kind === 'done' ? status.res : null
  const waiting = status.kind === 'working' || review.busy
  const elapsedMs = useElapsed(waiting)
  const aiDown = res && (res.aiStatus === 'QUOTA' || res.aiStatus === 'BUDGET' || res.aiStatus === 'FAILED')

  return (
    <section className={styles.textEditor} aria-labelledby="quote-text-fill-title">
      <div className={styles.textHead}>
        <label id="quote-text-fill-title" className="label" htmlFor="quote-text-fill">{QUOTE.fillBySpeech}</label>
        <div className={styles.inline}>
          <NbButton variant="ghost" onClick={() => void runReview()} disabled={disabled || review.busy || text.trim() === '' || draft.lines.every((l) => !l.name.trim())}>
            {review.busy ? progress(TEXT_FILL.aiReview) : TEXT_FILL.aiReview}
          </NbButton>
          <NbButton variant="ghost" onClick={() => void run(true)} disabled={disabled || status.kind === 'working' || text.trim() === ''}>
            {status.kind === 'working' ? progress(TEXT_FILL.reorganize) : TEXT_FILL.reorganize}
          </NbButton>
        </div>
      </div>
      <textarea
        id="quote-text-fill"
        ref={area}
        className={`input-field ${styles.textArea}`}
        value={text}
        disabled={disabled}
        placeholder={TEXT_FILL.placeholder}
        onChange={(e) => {
          const v = e.target.value
          onDraftChange((prev) => ({ ...prev, fillText: v }))
        }}
        onKeyUp={onCaret}
        onClick={onCaret}
        onSelect={onCaret}
      />
      {waiting && (() => {
        const w = quoteWaitProgress({ phase: 'speech', elapsedMs, saidChars: text.length })
        return <WaitProgress message={w.message} elapsedLabel={w.elapsedLabel} reassure={w.reassure} />
      })()}
      <div className={styles.textStatus} aria-live="polite">
        {status.kind === 'failed' && <span className={styles.textStatusWarn}>{status.message}</span>}
        {res && !aiDown && <span>{status.kind === 'done' && status.changed > 0 ? TEXT_FILL.changed(status.changed) : TEXT_FILL.unchanged}</span>}
        {aiDown && <span className={styles.textStatusWarn}>{TEXT_FILL.aiDown}</span>}
        {res && res.unread.length > 0 && <span>{TEXT_FILL.unread(res.unread.length)}</span>}
        {res && res.byAi.length > 0 && <span>{TEXT_FILL.byAi(res.byAi.length)}</span>}
        {/* 고른 모델이 막혀 다른 것이 읽었으면 그 사실 — 조용히 바꾸지 않는다 */}
        {res?.switchedNote && <span>{res.switchedNote}</span>}
        {active !== null && linked > 0 && <span>{TEXT_FILL.linked(linked)}</span>}
      </div>
      {res && res.unread.length > 0 && (
        <ul className={styles.unreadList}>
          {res.unread.map((u) => <li key={`${u.line}.${u.part}`}>{TEXT_FILL.fromLine(u.line)}: {u.text}</li>)}
        </ul>
      )}
      {review.error && <p className={`${styles.small} ${styles.textStatusWarn}`}>{review.error}</p>}
      {review.res && (review.res.aiStatus === 'QUOTA' || review.res.aiStatus === 'BUDGET' || review.res.aiStatus === 'FAILED') && (
        <p className={`${styles.small} ${styles.textStatusWarn}`}>{TEXT_FILL.aiDown}</p>
      )}
      {review.res && review.res.aiStatus === 'OK' && (
        <p className={styles.small}>{review.res.fixes.length + review.res.notices.length === 0 ? TEXT_FILL.reviewClean : TEXT_FILL.reviewFound(review.res.fixes.length, review.res.notices.length)}</p>
      )}
      {review.res && review.res.notices.length > 0 && (
        <ul className={styles.unreadList}>
          {review.res.notices.map((n, k) => <li key={k}>{n.note}</li>)}
        </ul>
      )}
      {res && res.differs.length > 0 && (
        <ul className={styles.unreadList}>
          {res.differs.map((d) => <li key={d.textKey}>{TEXT_FILL.differs(d.name)}</li>)}
        </ul>
      )}
    </section>
  )
}
