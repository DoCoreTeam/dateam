'use client'

/**
 * 이 회의에 묻기 — 옆 패널의 둘째 탭.
 *
 * 사용자 지시(2026-10-21): 회의를 띄워 둔 채 AI 에게 묻고, 근거가 달린 답을 받는다.
 *
 * 묻고 받은 것(`turns`)은 **작업대가 쥔다.** 이 부품은 패널을 닫거나 탭을 바꾸면 사라지는데,
 * 여기서 쥐면 근거를 보러 패널을 닫는 순간 답도 같이 사라진다.
 *
 * 세 상태를 섞지 않는다 (U-N)
 * - 답이 섰다: 답 + 근거 단추
 * - 근거를 못 찾았다: 「찾지 못했어요」, 서버가 지어낸 답을 버린 결과다
 * - 막혔다(키 없음 한도 연결): 막힌 이유, 빈 답으로 그리지 않는다
 *
 * 고칠 줄 제안은 사람이 **고른 것만** 정리본에 반영한다. 길은 정리본 「수정」과 같은 PUT 하나라
 * 다음 차례 정리로 쌓이고 「고침」 표시가 붙는다. 주인이 아니면 단추 대신 이유를 말한다.
 */

import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { Send, Quote, FileText, Check } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import InlineError from '@/components/ui/InlineError'
import WaitProgress from '@/components/ui/WaitProgress'
import { waitProgress } from '@/lib/ui/wait-progress'
import { WAIT } from '@/lib/terms/wait'
import { ACTION, progress } from '@/lib/terms'
import {
  ASK_MAX_QUESTION_CHARS, askApplyBody, suggestionPlace, type AskAnswer, type AskSuggestion,
} from '@/lib/meeting/ask'
import styles from './side-panel.module.css'

export interface AskTurn {
  id: number
  question: string
  startedAt: number
  /** 도는 중이면 둘 다 없다 */
  answer?: AskAnswer
  error?: { message: string; reason: string | null }
  /** 고른 제안을 정리본에 반영했다 — 몇 줄이 바뀌었나 */
  applied?: number
}

interface Props {
  noteId: string
  turns: AskTurn[]
  setTurns: Dispatch<SetStateAction<AskTurn[]>>
  /** 근거 줄을 누르면 원문 전사 그 줄로 */
  onEvidence: (ids: string[]) => void
  /** 정리본을 고칠 수 있나(주인) — 아니면 반영 단추 대신 이유 */
  canApply: boolean
  /** 반영이 끝났을 때 — 정리 패널이 새 차례를 다시 읽는다 */
  onApplied: () => void
  /** 반영 뒤에 이어서 할 일. CRM 미팅은 CRM 칸 다시 찾기 */
  applyFollowUp?: ReactNode
}

const ASK_FAILED = '답을 받지 못했어요. 연결을 확인하고 다시 물어봐 주세요.'
const ASK_APPLY_FAILED = '정리본에 반영하지 못했어요. 연결을 확인하고 다시 눌러 주세요.'
const ASK_APPLY_OWNER_ONLY = '정리본은 이 회의를 쓴 사람만 고칠 수 있어 반영 단추가 없어요.'

export default function AskPanel({ noteId, turns, setTurns, onEvidence, canApply, onApplied, applyFollowUp }: Props) {
  const [q, setQ] = useState('')
  const running = turns.some((t) => !t.answer && !t.error)

  async function ask(question: string) {
    const id = Date.now()
    setTurns((ts) => [...ts, { id, question, startedAt: id }])
    const settle = (patch: Partial<AskTurn>) => setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)))
    try {
      const res = await fetch(`/api/meeting-notes/${noteId}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body) {
        settle({ error: { message: body?.error ?? ASK_FAILED, reason: body?.reason ?? null } })
        return
      }
      settle({ answer: body as AskAnswer })
    } catch {
      settle({ error: { message: ASK_FAILED, reason: null } })
    }
  }

  function submit() {
    const question = q.trim()
    if (!question || running) return
    setQ('')
    void ask(question)
  }

  return (
    <div className={styles.records}>
      <p className={styles.hint}>이 회의의 메모와 전사에 있는 것만으로 답해요. 근거를 누르면 그 줄로 가요.</p>
      {turns.length > 0 && (
        <ol className={styles.turns}>
          {turns.map((t) => (
            <li key={t.id} className={styles.turn}>
              <p className={styles.turnQ}>{t.question}</p>
              <TurnBody turn={t} onEvidence={onEvidence} onRetry={() => void ask(t.question)} />
              {t.answer && t.answer.suggestions.length > 0 && (
                <Suggestions
                  noteId={noteId}
                  answer={t.answer}
                  applied={t.applied}
                  canApply={canApply}
                  followUp={applyFollowUp}
                  onApplied={(changed) => {
                    setTurns((ts) => ts.map((x) => (x.id === t.id ? { ...x, applied: changed } : x)))
                    onApplied()
                  }}
                />
              )}
            </li>
          ))}
        </ol>
      )}
      <form className={styles.askForm} onSubmit={(e) => { e.preventDefault(); submit() }}>
        <textarea
          className="input-field"
          rows={3}
          value={q}
          maxLength={ASK_MAX_QUESTION_CHARS}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            // 한글 조합 중의 Enter 는 글자 확정이다 — 그때 보내면 마지막 글자가 빠진다
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
          }}
          placeholder="예: 납기는 언제로 정했나요?"
          aria-label="이 회의에 물어볼 것"
        />
        <div className={styles.askActions}>
          <span className={styles.hint}>{q.length.toLocaleString()} / {ASK_MAX_QUESTION_CHARS.toLocaleString()}자</span>
          <NbButton type="submit" disabled={running || !q.trim()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Send size={14} aria-hidden /> 묻기
          </NbButton>
        </div>
      </form>
    </div>
  )
}

function TurnBody({ turn, onEvidence, onRetry }: { turn: AskTurn; onEvidence: (ids: string[]) => void; onRetry: () => void }) {
  if (turn.error) {
    return (
      <>
        <InlineError>{turn.error.message}</InlineError>
        {/* 키가 없으면 다시 물어도 같다 — 다시 묻기는 다시 해서 풀릴 수 있을 때만 */}
        {turn.error.reason !== 'no_key' && <NbButton variant="ghost" onClick={onRetry}>다시 묻기</NbButton>}
      </>
    )
  }
  if (!turn.answer) return <Waiting startedAt={turn.startedAt} />
  const a = turn.answer
  if (!a.found) return <p className={styles.notFound} role="status">{a.answer}</p>
  return (
    <div className={styles.answer}>
      <p className={styles.answerText}>{a.answer}</p>
      {a.partial && <p className={styles.hint}>회의가 길어 전사 앞부분만 읽고 답했어요.</p>}
      {(a.segmentIds.length > 0 || a.memoQuotes.length > 0) && (
        <div className={styles.evidence}>
          {a.segmentIds.map((id, i) => (
            <button key={id} type="button" className={styles.pick} onClick={() => onEvidence([id])}
              aria-label={`근거 전사 ${i + 1}번째 줄로 가기`}>
              <FileText size={12} aria-hidden /> 전사 근거 {i + 1}
            </button>
          ))}
          {a.memoQuotes.map((quote) => (
            <blockquote key={quote} className={styles.memoQuote}>
              <Quote size={12} aria-hidden /> 메모: {quote}
            </blockquote>
          ))}
        </div>
      )}
    </div>
  )
}

/** 도는 동안 무엇을 하는지 말한다 — 문구와 문턱은 공용 함수가 정한다(정책 B-7) */
function Waiting({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(t)
  }, [])
  const view = waitProgress(now - startedAt, WAIT.meetingAsk)
  return <WaitProgress message={view.message} elapsedLabel={view.elapsedLabel} reassure={view.reassure} />
}

/**
 * 고칠 줄 제안 — 바뀌기 전 줄은 빨강, 바뀔 글은 초록. 고른 것만 반영한다.
 * 기본은 아무것도 안 고른 상태다: AI 가 낸 것을 사람이 안 보고 반영하는 길을 만들지 않는다.
 */
function Suggestions({ noteId, answer, applied, canApply, followUp, onApplied }: {
  noteId: string
  answer: AskAnswer
  applied?: number
  canApply: boolean
  followUp?: ReactNode
  onApplied: (changed: number) => void
}) {
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toggle = (i: number) => setPicked((p) => {
    const next = new Set(p)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    return next
  })

  async function apply() {
    const body = askApplyBody(answer, picked)
    if (!body || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/meeting-notes/${noteId}/digest`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) { setError(out?.error ?? ASK_APPLY_FAILED); return }
      onApplied(Number(out.changed ?? 0))
    } catch {
      setError(ASK_APPLY_FAILED)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.suggestBox}>
      <p className={styles.groupLabel}>정리본에서 고칠 줄 {answer.suggestions.length}개</p>
      <ul className={styles.suggestList}>
        {answer.suggestions.map((sg, i) => (
          <li key={i}>
            <SuggestionRow sg={sg} checked={picked.has(i)} disabled={!canApply || applied !== undefined} onToggle={() => toggle(i)} />
          </li>
        ))}
      </ul>
      {error && <InlineError spaced onDismiss={() => setError(null)}>{error}</InlineError>}
      {applied !== undefined ? (
        <>
          <p className={styles.picked} role="status">
            <Check size={12} aria-hidden /> {applied > 0 ? `${applied}줄을 정리본에 반영했어요. 정리 위에 「고침」으로 쌓였어요.` : '바뀐 곳이 없어 그대로 두었어요.'}
          </p>
          {applied > 0 && followUp}
        </>
      ) : canApply ? (
        <NbButton onClick={() => void apply()} disabled={saving || picked.size === 0}>
          {saving ? progress(ACTION.apply) : `고른 ${picked.size}줄 ${ACTION.apply}`}
        </NbButton>
      ) : (
        <p className={styles.hint}>{ASK_APPLY_OWNER_ONLY}</p>
      )}
    </div>
  )
}

function SuggestionRow({ sg, checked, disabled, onToggle }: {
  sg: AskSuggestion
  checked: boolean
  disabled: boolean
  onToggle: () => void
}) {
  const place = suggestionPlace(sg.edit.path)
  return (
    <label className={styles.suggest} data-checked={checked || undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} aria-label={`${place} 고치기 선택`} />
      <span className={styles.suggestBody}>
        <span className={styles.recordMeta}>{place}</span>
        <del className={styles.diffOld}>{sg.before}</del>
        {sg.after.trim()
          ? <ins className={styles.diffNew}>{sg.after}</ins>
          : <span className={styles.diffNew}>이 줄을 지워요</span>}
      </span>
    </label>
  )
}
