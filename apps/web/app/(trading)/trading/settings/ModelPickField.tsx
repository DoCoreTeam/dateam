'use client'

// 판단 모델 고르기 — **이름을 외워 적지 않는다**
//
// 실측 2026-09-27 사용자 지적: 「설정에서 모델 고르게 해주면 되는거 아닌가」.
// 그전에는 글자 입력칸이었다. 모델 이름은 벤더가 수시로 바꾸고 391개가 있는데,
// 그중 하나를 오타 없이 적어 넣으라는 것은 설정이 아니라 시험이다.
//
// 고르기 창은 AI 공급자 화면이 쓰는 **같은 부품**이다(§2-5 동종 UI 통일).
// 목록을 읽는 문만 이 화면의 문(소유자)으로 바꿔 끼운다 — 관리자 창구를 부르면
// 「화면은 열리는데 창구가 403」이 된다.

import { useState, useEffect, useTransition } from 'react'
import { useEscClose } from '@/lib/use-esc-close'
import { Cpu } from 'lucide-react'
import {
  pickState, PICK_STATE_LABEL, PICK_STATE_REMEDY, type JudgeModelRow,
} from '@/lib/trading/settings/model-pick'
import { listJudgeModels } from './actions'
import styles from './ModelPickField.module.css'

interface Props {
  /** 지금 고른 공급자. 이 공급자의 모델만 보여 준다 */
  provider: string
  /** 지금 값 */
  current: string
  disabled: boolean
  onPick: (model: string) => void
}

export default function ModelPickField({ provider, current, disabled, onPick }: Props) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<JudgeModelRow[] | null>(null)
  const [withKey, setWithKey] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  // 화면을 덮는 자리는 ESC 로 닫힌다 (§2-2). 열렸을 때만 듣는다
  useEscClose(() => setOpen(false), open)

  // 창을 열 때만 읽는다. 화면을 그리는 것만으로 표를 훑지 않는다
  useEffect(() => {
    if (!open || rows !== null) return
    start(async () => {
      const r = await listJudgeModels()
      if (r.ok) { setRows(r.rows ?? []); setWithKey(r.withKey ?? []) }
      else setError(r.error ?? '모델 목록을 읽지 못했습니다')
    })
  }, [open, rows])

  const state = pickState({
    hasKey: withKey.includes(provider),
    rows, error, provider,
  })
  const mine = (rows ?? []).filter((r) => r.provider === provider)

  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
      <span
        className="mono"
        style={{ fontSize: 'var(--fs-sm)', color: current ? 'var(--text)' : 'var(--text-muted)' }}
      >
        {current || '아직 안 골랐습니다'}
      </span>
      <button
        type="button"
        className="btn btn-sm"
        disabled={disabled || pending}
        onClick={() => setOpen(true)}
      >
        <Cpu size={14} /> {current ? '모델 변경' : '모델 고르기'}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="판단 모델 고르기"
          style={{
            position: 'fixed', inset: 0, zIndex: 'var(--z-modal)', display: 'grid', placeItems: 'center',
            background: 'var(--modal-backdrop)', padding: 'var(--space-4)',
          }}
          onClick={() => setOpen(false)}
        >
          <div
            className="card"
            style={{ maxWidth: '34rem', width: '100%', maxHeight: '70vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: 0, marginBottom: 'var(--space-2)', fontSize: 'var(--fs-md)', fontWeight: 600 }}>
              {provider} 모델 고르기
            </h3>

            {state.kind !== 'ready' && (
              <div style={{ marginBottom: 'var(--space-3)' }}>
                <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--warning)' }}>
                  {PICK_STATE_LABEL[state.kind]}
                </p>
                <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                  {PICK_STATE_REMEDY[state.kind]}
                </p>
              </div>
            )}

            <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
              {mine.map((row) => (
                <button
                  key={row.modelId}
                  type="button"
                  className={`btn btn-sm ${styles.row}`}
                  onClick={() => { onPick(row.modelId); setOpen(false) }}
                >
                  <span className="mono">{row.modelId}</span>
                  {row.modelId === current && (
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>· 지금 값</span>
                  )}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 'var(--space-3)', display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
