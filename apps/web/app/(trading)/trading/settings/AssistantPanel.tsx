'use client'

// 말로 설정 바꾸기 — **확인 전에는 아무것도 안 바뀐다**
//
// 사용자 지적 2026-09-27: 「설정 도저히 나같은 수준에서는 쓸 수가 없이 복잡하고
// 뭘 이야기 하는지 모르겠네」 / 「프롬프트로 한번에 설정하거나 AI가 설정 해주거나」.
//
// 규정을 안 비켜 간다(명세 §15.2·§15.3·M7·M8): 금지 목록에 걸리는 키는 후보로도 안 오르고,
// 저장은 기존 창구를 그대로 지나 다음 거래일부터 듣는다. 이 화면은 **묻고 보여 줄 뿐**이다.

import { useState, useTransition } from 'react'
import { Wand2, Check } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import WaitProgress from '@/components/ui/WaitProgress'
import { useElapsedMs } from '@/components/ui/useElapsedMs'
import { waitProgress } from '@/lib/ui/wait-progress'
import { WAIT } from '@/lib/terms/wait'
import {
  ASSISTANT_TITLE, ASSISTANT_WHY, ASSISTANT_PLACEHOLDER, ASSISTANT_ASK,
  ASSISTANT_APPLY, ASSISTANT_EMPTY, ASSISTANT_WHEN, ASSISTANT_REJECTED_TITLE,
} from '@/lib/trading/settings/assistant-labels'
import type { AssistantPlan } from '@/lib/trading/settings/assistant'
import { proposeSettingChanges, applySettingChanges } from './actions'

export default function AssistantPanel() {
  const [ask, setAsk] = useState('')
  const [plan, setPlan] = useState<AssistantPlan | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, start] = useTransition()
  /*
    **기다리는 자리가 무엇을 하는지 말한다** (정책 B-7).
    실측 2026-09-28: 누르면 4~6초 동안 단추만 잠기고 화면에 아무 말이 없었다.
    AI 호출이라 더 걸리는 날도 있고, 그때 사람은 눌렸는지조차 모른다.
    문턱과 경과 표기는 `waitProgress` 가 정한다 — 여기서 다시 정하지 않는다.
  */
  const [waitFrom, setWaitFrom] = useState<number | null>(null)
  const [doing, setDoing] = useState<string>(WAIT.settingPropose)
  const elapsedMs = useElapsedMs(waitFrom)

  function propose() {
    setMessage(null)
    setDoing(WAIT.settingPropose)
    setWaitFrom(Date.now())
    start(async () => {
      const r = await proposeSettingChanges(ask)
      setPlan(r.plan ?? null)
      if (!r.ok) setMessage(r.userMessage)
      setWaitFrom(null)
    })
  }

  function apply() {
    if (!plan || plan.changes.length === 0) return
    setDoing(WAIT.settingApply)
    setWaitFrom(Date.now())
    start(async () => {
      const r = await applySettingChanges(
        plan.changes.map((c) => ({ key: c.key, nextValue: c.nextValue })),
      )
      setMessage(r.userMessage)
      if (r.ok) setPlan(null)
      setWaitFrom(null)
    })
  }

  return (
    <section className="card">
      <h2 style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)',
        margin: 0, marginBottom: 'var(--space-2)',
      }}>
        <Wand2 size={16} /> {ASSISTANT_TITLE}
      </h2>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0, marginBottom: 'var(--space-3)' }}>
        {ASSISTANT_WHY}
      </p>

      <textarea
        className="input-field"
        rows={2}
        value={ask}
        disabled={pending}
        placeholder={ASSISTANT_PLACEHOLDER}
        onChange={(e) => setAsk(e.target.value)}
        style={{ width: '100%', marginBottom: 'var(--space-2)' }}
      />
      <NbButton disabled={pending || ask.trim() === ''} onClick={propose}>
        <Wand2 size={14} /> {ASSISTANT_ASK}
      </NbButton>

      {waitFrom !== null && (() => {
        const w = waitProgress(elapsedMs, doing)
        return <WaitProgress message={w.message} elapsedLabel={w.elapsedLabel} reassure={w.reassure} />
      })()}

      {plan && plan.changes.length === 0 && (
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0, marginTop: 'var(--space-3)' }}>
          {ASSISTANT_EMPTY}
        </p>
      )}

      {plan && plan.changes.length > 0 && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <dl style={{ display: 'grid', gap: 'var(--space-2)', margin: 0 }}>
            {plan.changes.map((c) => (
              <div key={c.key} style={{ borderTop: '1px solid var(--border-color)', paddingTop: 'var(--space-2)' }}>
                <dt style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)' }}>{c.label}</dt>
                <dd style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>
                  <span className="mono">{String(c.currentValue)}</span>
                  {' → '}
                  <span className="mono">{String(c.nextValue)}</span>
                </dd>
                <dd style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{c.why}</dd>
              </div>
            ))}
          </dl>
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 'var(--space-2) 0' }}>
            {ASSISTANT_WHEN}
          </p>
          <NbButton disabled={pending} onClick={apply}>
            <Check size={14} /> {ASSISTANT_APPLY}
          </NbButton>
        </div>
      )}

      {/* 안 올라간 줄도 보여 준다. 조용히 사라지면 같은 말을 또 하게 된다 */}
      {plan && plan.rejected.length > 0 && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <p style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)', margin: 0 }}>
            {ASSISTANT_REJECTED_TITLE}
          </p>
          <ul style={{ margin: 0, paddingLeft: '1.05rem' }}>
            {plan.rejected.map((r, i) => (
              <li key={`${r.key}-${i}`} style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                <span className="mono">{r.key}</span> · {r.userMessage}
              </li>
            ))}
          </ul>
        </div>
      )}

      {message && (
        <p role="status" style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0, marginTop: 'var(--space-3)' }}>
          {message}
        </p>
      )}
    </section>
  )
}
