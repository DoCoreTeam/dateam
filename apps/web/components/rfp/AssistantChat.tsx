'use client'

// 어시스턴트 본체 — 전체 화면과 오른쪽 아래 패널이 **같은 것을 쓴다.**
//
// 예전에는 어시스턴트가 메뉴 안에만 있었다. 리포트를 읽다 뭔가 물으려면
// 화면을 떠나야 했고, 떠나면 물어보려던 것을 잊는다. 그래서 같은 대화를
// 두 자리에 띄운다 — 코드는 한 벌이다.

import { useState } from 'react'
import { Send } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { isEnterKey, isImeComposing } from '@/lib/ui/ime'
import { RFP_ASSISTANT, RFP_COMMON, AI_NOTICE } from '@/lib/rfp/terms'
import styles from '@/app/(rfp)/rfp.module.css'

interface Answer {
  text: string
  citations: { index: number; chunkKey: string; caseId: string; blockIds: string[] }[]
  droppedForClass: number
  notice: string
}

export interface AssistantChatProps {
  /** 좁은 자리(패널)에서는 예시를 접는다 */
  compact?: boolean
}

export default function AssistantChat({ compact = false }: AssistantChatProps) {
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [cases, setCases] = useState<{ id: string; title: string }[]>([])

  const ask = async (text: string) => {
    const q = text.trim()
    if (!q) return
    setError(null)
    setBusy(true)
    setAnswer(null)
    try {
      const res = await fetch('/api/rfp/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q }),
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
    <div className={styles.inner}>
      {error && <FormErrorBanner message={error} />}

      <div className={styles.field}>
        <label className="label" htmlFor="rfp-q">{RFP_ASSISTANT.ask}</label>
        <div className={styles.row}>
          <input
            id="rfp-q"
            className="input-field"
            value={question}
            placeholder={RFP_ASSISTANT.placeholder}
            onChange={(e) => setQuestion(e.target.value)}
            // 한글 입력 중의 Enter 는 글자를 확정하는 것이지 보내는 것이 아니다(lib/ui/ime SSOT)
            onKeyDown={(e) => { if (isEnterKey(e) && !isImeComposing(e)) void ask(question) }}
          />
          <NbButton onClick={() => void ask(question)} disabled={busy || !question.trim()}>
            <Send size={14} /> {busy ? RFP_ASSISTANT.thinking : RFP_ASSISTANT.send}
          </NbButton>
        </div>
      </div>

      {/* 무엇을 물어야 하는지 모르는 사람이 첫 사용자다 */}
      {!answer && !busy && !compact && (
        <div className={styles.tight}>
          <span className={styles.sectionDesc}>{RFP_ASSISTANT.examplesLead}</span>
          <div className={styles.row}>
            {RFP_ASSISTANT.examples.map((x) => (
              <NbButton key={x} variant="ghost" onClick={() => { setQuestion(x); void ask(x) }}>
                {x}
              </NbButton>
            ))}
          </div>
        </div>
      )}

      {answer && (
        <div className="card">
          <div className={styles.inner}>
            <NbBadge status="note">{answer.notice || AI_NOTICE}</NbBadge>
            <p style={{ whiteSpace: 'pre-wrap' }}>{answer.text}</p>

            {answer.citations.length > 0 ? (
              <div className={styles.tight}>
                <span className="label">{RFP_ASSISTANT.citations}</span>
                <div className={styles.row}>
                  {answer.citations.map((c) => (
                    <NbButton key={c.chunkKey} variant="ghost" href={`/rfp/${c.caseId}`}>
                      {c.index}
                    </NbButton>
                  ))}
                </div>
              </div>
            ) : (
              <span className={styles.sectionDesc}>{RFP_ASSISTANT.noAnswer}</span>
            )}

            {answer.droppedForClass > 0 && (
              <NbBadge status="doing">{RFP_ASSISTANT.droppedForClass}</NbBadge>
            )}
          </div>
        </div>
      )}

      {cases.length > 0 && (
        <div className={styles.tight}>
          <span className="label">{RFP_ASSISTANT.relatedCases}</span>
          {cases.map((c) => (
            <a key={c.id} href={`/rfp/${c.id}`}>{c.title}</a>
          ))}
        </div>
      )}
    </div>
  )
}
