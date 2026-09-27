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
import { Compass, Check, RotateCcw } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import {
  START_TITLE, START_WHY, START_STANCE_Q, START_STANCE_HINT, STANCE_LABEL,
  START_TARGET_Q, START_TARGET_HINT, START_LOSS_Q, START_LOSS_HINT,
  START_ASK, START_APPLY, START_FILLED_HEAD, START_WHEN,
  START_PERSON_MARK, START_EDITED_MARK, START_RESET_ONE, START_EDIT_HINT,
  riskLine, riskUnmeasured, raiseWarning,
} from '@/lib/trading/settings/start-labels'
import {
  STANCES, riskView, raisesLossLimit,
  type Stance, type FilledValue, type RiskView, type StartOverrides,
} from '@/lib/trading/settings/onboarding'
import { previewStart, applyStart } from './actions'
import styles from './StartPanel.module.css'

export default function StartPanel() {
  const [stance, setStance] = useState<Stance>('normal')
  const [target, setTarget] = useState('300000')
  const [loss, setLoss] = useState('500000')
  const [filled, setFilled] = useState<FilledValue[] | null>(null)
  const [risk, setRisk] = useState<RiskView | null>(null)
  const [currentLimit, setCurrentLimit] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, start] = useTransition()
  /**
   * 미리보기 표에서 손댄 값. **글자 그대로** 들고 있다가 보낼 때 숫자로 바꾼다 —
   * 숫자로 즉시 바꾸면 지우는 도중(빈칸·마이너스만 남은 칸)에 0 으로 튄다
   */
  const [edits, setEdits] = useState<Record<string, string>>({})

  const answers = { stance, targetKrw: Number(target) || 0, lossLimitKrw: Number(loss) || 0 }

  /** 보낼 꼴. 숫자로 안 읽히는 칸은 아예 안 보낸다 — 창구가 계산된 값으로 돌아간다 */
  function overridesOf(): StartOverrides {
    const out: Record<string, number> = {}
    for (const [key, text] of Object.entries(edits)) {
      const n = Number(text)
      if (text.trim() !== '' && Number.isFinite(n)) out[key] = n
    }
    return out
  }

  /**
   * 지금 표에 보이는 값. **손댄 값이 이기고**, 창구가 보낸 값이 그 아래에 있다.
   * 화면이 이 자리에서 계산해야 한 글자 고칠 때마다 서버를 두드리지 않는다
   */
  function shownValue(f: FilledValue): string {
    return edits[f.key] ?? String(f.value)
  }

  function isEdited(f: FilledValue): boolean {
    const text = edits[f.key]
    if (text === undefined) return f.edited
    return text.trim() !== '' && Number(text) !== Number(f.computed)
  }

  /** 손댄 손실 한도. 없으면 창구가 계산한 값 */
  const shownLimit = (() => {
    const row = filled?.find((f) => f.key === 'daily_loss_limit_krw')
    if (!row) return answers.lossLimitKrw
    const n = Number(shownValue(row))
    return Number.isFinite(n) ? n : Number(row.value)
  })()

  // 같은 순수 함수로 다시 잰다 — 화면이 자기 셈을 따로 두면 창구와 갈린다 (M6)
  const shownRisk = risk ? riskView(risk.onceKrw, shownLimit) : null
  const shownRaises = raisesLossLimit(shownLimit, currentLimit)

  function preview() {
    setMessage(null)
    start(async () => {
      const r = await previewStart(answers, overridesOf())
      setFilled(r.filled ?? null)
      setRisk(r.risk ?? null)
      setCurrentLimit(r.currentLossLimitKrw ?? 0)
      if (!r.ok) setMessage(r.userMessage)
    })
  }

  function apply() {
    start(async () => {
      const r = await applyStart(answers, overridesOf())
      setMessage(r.userMessage)
      if (r.ok) { setFilled(null); setEdits({}) }
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
              <NbButton
                key={s}
                type="button"
                /* 고른 것만 채워 그린다 — 셋이 다 같은 색이면 무엇을 골랐는지 화면이 말 안 한다 */
                variant={s === stance ? 'primary' : 'secondary'}
                disabled={pending}
                onClick={() => setStance(s)}
              >
                {STANCE_LABEL[s]}
              </NbButton>
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
          <NbButton disabled={pending} onClick={preview}>
            <Compass size={14} /> {START_ASK}
          </NbButton>
        </div>

        {filled && filled.length > 0 && (
          <div className={styles.preview}>
            <span className={styles.previewHead}>{START_FILLED_HEAD}</span>
            <span className={styles.hint}>{START_EDIT_HINT}</span>
            <dl className={styles.filled}>
              {filled.map((f) => (
                <div key={f.key} className={styles.filledRow}>
                  <dt className={styles.filledName}>
                    <label htmlFor={`start-fill-${f.key}`}>{f.label}</label>
                    {/* 사람이 답해야 하는 값은 그 사실을 남긴다 (§15.3) */}
                    {f.needsPerson && <span className={styles.hint}> {START_PERSON_MARK}</span>}
                    {/* 손댄 값도 같은 꼴로 갈라 적는다 — 계산된 값과 섞이면 고친 줄을 못 찾는다 */}
                    {isEdited(f) && <span className={styles.editedMark}> {START_EDITED_MARK}</span>}
                  </dt>
                  <dd className={styles.filledValue}>
                    <input
                      id={`start-fill-${f.key}`}
                      className="input-field mono"
                      type="number"
                      step="any"
                      value={shownValue(f)}
                      disabled={pending}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    />
                    {isEdited(f) && (
                      <NbButton
                        type="button"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => setEdits((prev) => {
                          const next = { ...prev }
                          delete next[f.key]
                          return next
                        })}
                      >
                        <RotateCcw size={13} /> {START_RESET_ONE}
                      </NbButton>
                    )}
                  </dd>
                </div>
              ))}
            </dl>

            {shownRisk && (
              <span className={shownRisk.fits ? styles.risk : styles.riskBad}>
                {shownRisk.onceKrw > 0 ? riskLine(shownRisk) : riskUnmeasured()}
              </span>
            )}
            {shownRaises && <span className={styles.warn}>{raiseWarning()}</span>}

            <span className={styles.hint}>{START_WHEN}</span>
            <div className={styles.actions}>
              <NbButton disabled={pending} onClick={apply}>
                <Check size={14} /> {START_APPLY}
              </NbButton>
            </div>
          </div>
        )}

        {message && <p role="status" className={styles.hint} style={{ margin: 0 }}>{message}</p>}
      </div>
    </section>
  )
}
