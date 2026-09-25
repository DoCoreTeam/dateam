'use client'

// 알림 켜기 — **검증이 먼저다** (C4)
//
// 못 켤 때 단추를 그냥 흐리게 두지 않는다. 흐린 단추는 왜 못 누르는지를 안 말하고,
// 사용자는 화면이 고장난 것으로 읽는다.
//
// 끄기는 언제나 눌린다. 켜기와 대칭으로 만들면 관문이 깨진 날 끄지도 못한다.

import { useState, useTransition } from 'react'
import { BellOff, BellRing } from 'lucide-react'
import type { NotifySummary, PositionRow } from '@/lib/trading/overview-shape'
import { setNotifyEnabled } from './actions'

interface Props {
  notify: NotifySummary
  position: PositionRow | null
}

export default function NotifyPanel({ notify, position }: Props) {
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function toggle(next: boolean) {
    startTransition(async () => {
      const result = await setNotifyEnabled(next)
      setMessage(result.userMessage)
    })
  }

  return (
    <section className="card">
      <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)', margin: 0, marginBottom: 'var(--space-2)' }}>
        알림
      </h2>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', margin: 0, marginBottom: 'var(--space-2)' }}>
        {notify.hint}
      </p>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 0, marginBottom: 'var(--space-3)' }}>
        섀도 {notify.shadowTradeDays}일 · 필요 {notify.requiredShadowDays}일
      </p>

      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        {notify.enabled ? (
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => toggle(false)}>
            <BellOff size={14} /> 알림 끄기
          </button>
        ) : (
          <button
            type="button" className="btn btn-sm btn-primary"
            disabled={pending || !notify.canEnable}
            title={notify.canEnable ? undefined : notify.hint}
            onClick={() => toggle(true)}
          >
            <BellRing size={14} /> 알림 켜기
          </button>
        )}
      </div>

      {message && (
        <p role="status" style={{ fontSize: 'var(--fs-sm)', color: 'var(--nb-danger)', margin: 0, marginTop: 'var(--space-3)' }}>
          {message}
        </p>
      )}

      {position && (
        <dl style={{ display: 'grid', gap: 'var(--space-2)', margin: 0, marginTop: 'var(--space-4)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'space-between' }}>
            <dt style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>포지션</dt>
            <dd style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>{position.positionState}</dd>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'space-between' }}>
            <dt style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>손절</dt>
            <dd style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>{position.protectionLabel}</dd>
          </div>
          {position.needsHumanUnlock && (
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--nb-danger)', margin: 0 }}>
              증권사 계좌와 기록이 다릅니다. 확인해 주세요 · {position.reason}
            </p>
          )}
        </dl>
      )}
    </section>
  )
}
