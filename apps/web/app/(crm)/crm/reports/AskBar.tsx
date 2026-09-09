'use client'

/**
 * 도우미 한 줄 — 자연어를 리포트 조건으로 바꾼다.
 *
 * **실행 전에 「이렇게 이해했습니다」를 보여준다.** 숫자만 바뀌면 사람은 자기가 무엇을
 * 물었는지 잊고, 틀린 조건으로 나온 표를 맞는 것으로 읽는다.
 *
 * **못 알아들은 것을 숨기지 않는다.** 「그 부분은 못 알아들었어요」를 말하고, 그래도
 * 지표와 기간이 잡혔으면 **거기까지는 연다** — 아무것도 안 여는 것보다 낫다.
 */

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { ASSISTANT } from '@/lib/terms/report'
import { isEnterKey } from '@/lib/ui/ime'
import s from './metrics.module.css'

interface AskResult {
  readbackLabel: string
  readback: string
  params: Record<string, string>
  unresolved: string[]
  usedAi: boolean
  note: string | null
  runnable: boolean
}

interface Props {
  /** 조건을 주소에 반영한다 — 도우미도 화면과 **같은 길**로 움직인다 */
  onRun: (params: Record<string, string>) => void
}

export default function AskBar({ onRun }: Props) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<AskResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function ask() {
    const q = text.trim()
    if (!q || busy) return
    setBusy(true); setErr(null); setRes(null)
    try {
      const r = await fetch('/api/crm/metrics/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: q }),
      })
      const json = await r.json().catch(() => null)
      if (!r.ok) { setErr(json?.error?.message ?? '알아듣지 못했습니다.'); return }
      const out = json as AskResult
      setRes(out)
      // 지표와 기간이 잡혔으면 바로 연다 — 한 번 더 누르게 하지 않는다
      if (out.runnable) onRun(out.params)
    } catch {
      setErr('알아듣지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={s.ask}>
      <div className={s.askRow}>
        <Sparkles size={16} className={s.askIcon} aria-hidden />
        <input
          className="input-field"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (isEnterKey(e)) { e.preventDefault(); void ask() } }}
          placeholder="이번 분기 파이프라인별 수주 보여줘"
          aria-label={ASSISTANT.placeholder}
        />
        <NbButton onClick={() => void ask()} disabled={busy || !text.trim()}>
          {busy ? <AXDotLoader /> : '물어보기'}
        </NbButton>
      </div>

      {res && (
        <div className={s.askOut} role="status">
          <span className={s.askLabel}>{res.readbackLabel}</span>
          <span className={s.askRead}>{res.readback || '아직 아무 조건도 못 잡았어요'}</span>
          {res.unresolved.length > 0 && (
            <span className={s.askMiss}>못 알아들은 것 · {res.unresolved.join(' · ')}</span>
          )}
          {res.note && <span className={s.askMiss}>{res.note}</span>}
          {!res.runnable && (
            <span className={s.askMiss}>지표와 기간이 있어야 표를 열 수 있어요</span>
          )}
        </div>
      )}

      {err && <p className={s.err} role="alert">{err}</p>}
    </div>
  )
}
