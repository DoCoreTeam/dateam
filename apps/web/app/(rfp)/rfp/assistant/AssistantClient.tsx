'use client'

// 어시스턴트 — 답변에 근거가 붙고, 근거를 누르면 원문으로 간다.
//
// 근거 없는 답은 그럴듯한 소문이다. 그래서 인용이 없으면 그 사실을 화면에 적는다.

import { useState } from 'react'
import { Send } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { isEnterKey, isImeComposing } from '@/lib/ui/ime'
import { RFP_ASSISTANT, RFP_COMMON, AI_NOTICE } from '@/lib/rfp/terms'

interface Answer {
  text: string
  citations: { index: number; chunkKey: string; caseId: string; blockIds: string[] }[]
  droppedForClass: number
  notice: string
}

export default function AssistantClient() {
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [cases, setCases] = useState<{ id: string; title: string }[]>([])

  const ask = async () => {
    if (!question.trim()) return
    setError(null)
    setBusy(true)
    setAnswer(null)
    try {
      const res = await fetch('/api/rfp/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: question.trim() }),
      })
      const body = await res.json()
      if (!res.ok) { setError(RFP_COMMON.error); return }
      setCases(body.cases ?? [])
      setAnswer(body.answer ?? null)
    } catch {
      setError(RFP_COMMON.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {error && <FormErrorBanner message={error} />}

      <div className="field">
        <label className="label" htmlFor="rfp-q">{RFP_ASSISTANT.title}</label>
        <input
          id="rfp-q"
          className="input-field"
          value={question}
          placeholder={RFP_ASSISTANT.placeholder}
          onChange={(e) => setQuestion(e.target.value)}
          // 한글 입력 중의 Enter 는 글자를 확정하는 것이지 보내는 것이 아니다(lib/ui/ime SSOT)
          onKeyDown={(e) => { if (isEnterKey(e) && !isImeComposing(e)) void ask() }}
        />
      </div>

      <NbButton onClick={() => void ask()} disabled={busy || !question.trim()}>
        <Send size={14} /> {busy ? RFP_ASSISTANT.thinking : RFP_ASSISTANT.send}
      </NbButton>

      {answer && (
        <div className="card">
          <NbBadge status="note">{answer.notice || AI_NOTICE}</NbBadge>
          <p style={{ whiteSpace: 'pre-wrap' }}>{answer.text}</p>

          {answer.citations.length > 0 ? (
            <div>
              <span className="label">{RFP_ASSISTANT.citations}</span>
              {answer.citations.map((c) => (
                <NbButton key={c.chunkKey} variant="ghost" href={`/rfp/${c.caseId}`}>
                  {c.index}
                </NbButton>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>{RFP_ASSISTANT.noAnswer}</p>
          )}

          {answer.droppedForClass > 0 && (
            <NbBadge status="doing">{RFP_ASSISTANT.droppedForClass}</NbBadge>
          )}
        </div>
      )}

      {cases.length > 0 && (
        <ul>
          {cases.map((c) => (
            <li key={c.id}><a href={`/rfp/${c.id}`}>{c.title}</a></li>
          ))}
        </ul>
      )}
    </div>
  )
}
