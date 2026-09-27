'use client'

// 공급자와 모델 고르기 — **한 모달에서 둘 다**
//
// 사용자 지적 2026-09-27: 「gemini로 박지 말라고 우리 AI 키 들어 간거 다 쓸수 있도록
// 공용방식이어야지 모달로 프로바이더랑 모델 선택하게」.
//
// 왜 쌍인가: 모델만 바꾸고 공급자가 그대로면 그 공급자에 없는 모델을 가리키게 된다.
// 화면에는 이름이 멀쩡히 적혀 있는데 판단은 한 건도 안 남는다. 둘은 같이 바뀐다.
//
// 탭에는 **키가 등록된 공급자만** 세운다. 없는 키를 고르면 그 자리는 영영 안 돈다.

import { useState, useEffect, useTransition } from 'react'
import { Cpu } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'
import {
  pickState, tabsFor, PICK_STATE_LABEL, PICK_STATE_REMEDY,
  MODEL_PICK, MODEL_PICK_TITLE, MODEL_NOT_PICKED, MODEL_IN_USE, MODEL_LIST_FAILED,
  type JudgeModelRow,
} from '@/lib/trading/settings/model-pick'
import { ACTION } from '@/lib/terms'
import { listJudgeModels, savePickedModel } from './actions'
import styles from './ModelPickField.module.css'

interface Props {
  /** 공급자 설정 키. 모델과 함께 저장된다 */
  providerKey: string
  /** 모델 설정 키 */
  modelKey: string
  /** 지금 공급자 */
  provider: string
  /** 지금 모델 */
  current: string
  disabled: boolean
  onSaved: (provider: string, model: string) => void
}

export default function ModelPickField({
  providerKey, modelKey, provider, current, disabled, onSaved,
}: Props) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState(provider)
  const [rows, setRows] = useState<JudgeModelRow[] | null>(null)
  const [withKey, setWithKey] = useState<string[]>([])
  const [all, setAll] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, start] = useTransition()
  useEscClose(() => setOpen(false), open)

  // 창을 열 때만 읽는다. 화면을 그리는 것만으로 표를 훑지 않는다
  useEffect(() => {
    if (!open || rows !== null) return
    start(async () => {
      const r = await listJudgeModels()
      if (r.ok) { setRows(r.rows ?? []); setWithKey(r.withKey ?? []); setAll(r.providers ?? []) }
      else setError(r.error ?? MODEL_LIST_FAILED)
    })
  }, [open, rows])

  const tabs = tabsFor(all, withKey)
  const state = pickState({ hasKey: withKey.includes(tab), rows, error, provider: tab })
  const mine = (rows ?? []).filter((r) => r.provider === tab)

  function pick(model: string) {
    start(async () => {
      // **둘을 같이 저장한다.** 한쪽만 바뀌면 없는 모델을 가리킨다
      const r = await savePickedModel(providerKey, modelKey, tab, model)
      setMessage(r.userMessage)
      if (r.ok) { onSaved(tab, model); setOpen(false) }
    })
  }

  return (
    <div className={styles.field}>
      <span className={`mono ${styles.current}`}>
        {current ? `${provider} · ${current}` : MODEL_NOT_PICKED}
      </span>
      <button type="button" className="btn btn-sm" disabled={disabled || pending} onClick={() => setOpen(true)}>
        <Cpu size={14} /> {current ? ACTION.change : MODEL_PICK}
      </button>
      {message && <span role="status" className={styles.muted}>{message}</span>}

      {open && (
        <div
          role="dialog"
          aria-label="공급자와 모델 고르기"
          className={styles.backdrop}
          onClick={() => setOpen(false)}
        >
          <div className={`card ${styles.panel}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.head}>
              <h3>{MODEL_PICK_TITLE}</h3>
              <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>{ACTION.close}</button>
            </div>

            <div className={styles.body}>
            {/* 키가 등록된 공급자만 세운다 */}
            <div className={styles.tabs}>
              {tabs.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`btn btn-sm ${id === tab ? 'btn-primary' : ''}`}
                  onClick={() => setTab(id)}
                >
                  {id}
                </button>
              ))}
            </div>

            {state.kind !== 'ready' && (
              <div className={styles.blocked}>
                <p className={styles.blockedWhy}>{PICK_STATE_LABEL[state.kind]}</p>
                <p className={styles.blockedHow}>{PICK_STATE_REMEDY[state.kind]}</p>
              </div>
            )}

            <div className={styles.list}>
              {mine.map((row) => (
                <button
                  key={row.modelId}
                  type="button"
                  className="btn btn-sm"
                  disabled={pending}
                  onClick={() => pick(row.modelId)}
                >
                  <span className={styles.row}>
                    <span className="mono">{row.modelId}</span>
                    {row.modelId === current && tab === provider && (
                      <span className={styles.muted}>{MODEL_IN_USE}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>

            </div>

            <div className={styles.foot}>
              <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>{ACTION.close}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
