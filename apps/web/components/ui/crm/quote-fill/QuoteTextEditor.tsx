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
import { QUOTE, TEXT_FILL, progress } from '@/lib/terms'
import { kindFromDomain, type CompanyKind } from '@/lib/crm/domain/company-kind'
import { readResponse } from '@/lib/crm/api/read-error'
import type { QuoteDraft } from '../quote-draft-shape'
import { applyTextFill, fromLinesOf, toClientLines, type TextFillJson } from './text-fill-apply'
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
  const aiDown = res && (res.aiStatus === 'QUOTA' || res.aiStatus === 'BUDGET' || res.aiStatus === 'FAILED')

  return (
    <section className={styles.textEditor} aria-labelledby="quote-text-fill-title">
      <div className={styles.textHead}>
        <label id="quote-text-fill-title" className="label" htmlFor="quote-text-fill">{QUOTE.fillBySpeech}</label>
        <NbButton variant="ghost" onClick={() => void run(true)} disabled={disabled || status.kind === 'working' || text.trim() === ''}>
          {status.kind === 'working' ? progress(TEXT_FILL.reorganize) : TEXT_FILL.reorganize}
        </NbButton>
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
      <div className={styles.textStatus} aria-live="polite">
        {status.kind === 'working' && <span>{progress(TEXT_FILL.working)}</span>}
        {status.kind === 'failed' && <span className={styles.textStatusWarn}>{status.message}</span>}
        {res && !aiDown && <span>{status.kind === 'done' && status.changed > 0 ? TEXT_FILL.changed(status.changed) : TEXT_FILL.unchanged}</span>}
        {aiDown && <span className={styles.textStatusWarn}>{TEXT_FILL.aiDown}</span>}
        {res && res.unread.length > 0 && <span>{TEXT_FILL.unread(res.unread.length)}</span>}
        {active !== null && linked > 0 && <span>{TEXT_FILL.linked(linked)}</span>}
      </div>
      {res && res.unread.length > 0 && (
        <ul className={styles.unreadList}>
          {res.unread.map((u) => <li key={`${u.line}.${u.part}`}>{TEXT_FILL.fromLine(u.line)}: {u.text}</li>)}
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
