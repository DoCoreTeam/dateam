'use client'

// 세 문항으로 시작하기 (설계서 §12)
//
// 설정 92개를 처음 여는 사람에게 다 내놓는 것은 설정이 아니라 시험이다
// (사용자 지적 2026-09-27). 셋만 답하면 나머지를 채운다.
//
// **확인 전에는 아무것도 안 바뀐다.** 무엇을 어떻게 채울지 먼저 보여 주고,
// 한 번에 얼마를 잃을 수 있는지를 같은 화면에서 말한다(M6).
// 저장은 기존 창구를 지나 다음 거래일부터 듣는다(M7).

import { useState, useTransition } from 'react'
import { Compass, Check } from 'lucide-react'
import {
  START_TITLE, START_WHY, START_STANCE_Q, START_STANCE_HINT, STANCE_LABEL,
  START_TARGET_Q, START_TARGET_HINT, START_LOSS_Q, START_LOSS_HINT,
  START_ASK, START_APPLY, START_FILLED_HEAD, START_WHEN,
  START_PERSON_MARK, riskLine, riskUnmeasured, raiseWarning,
} from '@/lib/trading/settings/start-labels'
import { STANCES, type Stance, type FilledValue, type RiskView } from '@/lib/trading/settings/onboarding'
import { previewStart, applyStart } from './actions'
import styles from './StartPanel.module.css'

export default function StartPanel() {
  const [stance, setStance] = useState<Stance>('normal')
  const [target, setTarget] = useState('300000')
  const [loss, setLoss] = useState('500000')
  const [filled, setFilled] = useState<FilledValue[] | null>(null)
  const [risk, setRisk] = useState<RiskView | null>(null)
  const [raises, setRaises] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const answers = { stance, targetKrw: Number(target) || 0, lossLimitKrw: Number(loss) || 0 }

  function preview() {
    setMessage(null)
    start(async () => {
      const r = await previewStart(answers)
      setFilled(r.filled ?? null)
      setRisk(r.risk ?? null)
      setRaises(r.raisesLimit === true)
      if (!r.ok) setMessage(r.userMessage)
    })
  }

  function apply() {
    start(async () => {
      const r = await applyStart(answers)
      setMessage(r.userMessage)
      if (r.ok) setFilled(null)
    })
  }

  return (
    <section className="card">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 0, marginBottom: 'var(--space-2)', fontSize: 'var(--fs-md)', fontWeight: 600 }}>
        <Compass size={16} /> {START_TITLE}
      </h2>
      <p className={styles.hint} style={{ marginTop: 0, marginBottom: 'var(--space-4)' }}>{START_WHY}</p>

      <div className={styles.panel}>
        <div className={styles.q}>
          <span className={styles.label}>{START_STANCE_Q}</span>
          <div className={styles.seg}>
            {STANCES.map((s) => (
              <button
                key={s}
                type="button"
                className={`btn btn-sm ${s === stance ? 'btn-primary' : ''}`}
                disabled={pending}
                onClick={() => setStance(s)}
              >
                {STANCE_LABEL[s]}
              </button>
            ))}
          </div>
          <span className={styles.hint}>{START_STANCE_HINT}</span>
        </div>

        <div className={styles.q}>
          <label className={styles.label} htmlFor="start-target">{START_TARGET_Q}</label>
          <div className={styles.money}>
            <input
              id="start-target" className="input-field mono" type="number" min={0} step={10000}
              value={target} disabled={pending} onChange={(e) => setTarget(e.target.value)}
            />
            <span className={styles.unit}>원</span>
          </div>
          <span className={styles.hint}>{START_TARGET_HINT}</span>
        </div>

        <div className={styles.q}>
          <label className={styles.label} htmlFor="start-loss">{START_LOSS_Q}</label>
          <div className={styles.money}>
            <input
              id="start-loss" className="input-field mono" type="number" min={0} step={10000}
              value={loss} disabled={pending} onChange={(e) => setLoss(e.target.value)}
            />
            <span className={styles.unit}>원</span>
          </div>
          <span className={styles.hint}>{START_LOSS_HINT}</span>
        </div>

        <div className={styles.actions}>
          <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={preview}>
            <Compass size={14} /> {START_ASK}
          </button>
        </div>

        {filled && filled.length > 0 && (
          <div className={styles.preview}>
            <span className={styles.previewHead}>{START_FILLED_HEAD}</span>
            <dl className={styles.filled}>
              {filled.map((f) => (
                <div key={f.key} className={styles.filledRow}>
                  <dt>
                    {f.label}
                    {/* 사람이 답해야 하는 값은 그 사실을 남긴다 (§15.3) */}
                    {f.needsPerson && <span className={styles.hint}> {START_PERSON_MARK}</span>}
                  </dt>
                  <dd className={`mono ${styles.filledValue}`} style={{ margin: 0 }}>{String(f.value)}</dd>
                </div>
              ))}
            </dl>

            {risk && (
              <span className={risk.fits ? styles.risk : styles.riskBad}>
                {risk.onceKrw > 0 ? riskLine(risk) : riskUnmeasured()}
              </span>
            )}
            {raises && <span className={styles.warn}>{raiseWarning()}</span>}

            <span className={styles.hint}>{START_WHEN}</span>
            <div className={styles.actions}>
              <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={apply}>
                <Check size={14} /> {START_APPLY}
              </button>
            </div>
          </div>
        )}

        {message && <p role="status" className={styles.hint} style={{ margin: 0 }}>{message}</p>}
      </div>
    </section>
  )
}
