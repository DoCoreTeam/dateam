'use client'

// 자동 주문 — **무장은 설정이 아니라 상태다**
//
// 설정 하나로 켜고 끄면 화면에서 스무 개 값 중 하나로 보인다. 잘못 눌러도 아무 일 없어 보이고,
// 그런데 그 하나가 돈을 움직인다. 그래서 자리를 따로 두고, 언제 스스로 풀리는지를 같이 적는다.
//
// 해제 단추는 **관문과 무관하게** 늘 눌린다. 대칭으로 만들면 문제가 생긴 날 끄지도 못한다.

import { useState, useTransition } from 'react'
import { ShieldCheck, ShieldOff } from 'lucide-react'
import { formatKstDateTimeExact } from '@/lib/datetime/kst'
import type { ArmingSummary } from '@/lib/trading/overview-shape'
import { setAutoOrderArmed } from './actions'

export default function ArmingPanel({ arming }: { arming: ArmingSummary }) {
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function toggle(next: boolean) {
    startTransition(async () => {
      const r = await setAutoOrderArmed(next)
      setMessage(r.userMessage)
    })
  }

  return (
    <section className="card">
      <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)', margin: 0, marginBottom: 'var(--space-2)' }}>
        자동 주문
      </h2>

      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', margin: 0, marginBottom: 'var(--space-2)' }}>
        {arming.armed
          ? `무장 중입니다. ${arming.expiresAt ? formatKstDateTimeExact(arming.expiresAt) : ''} 에 스스로 풀립니다`
          : '무장되지 않았습니다. 주문은 사람이 직접 합니다'}
      </p>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 0, marginBottom: 'var(--space-2)' }}>
        {arming.hint}
      </p>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 0, marginBottom: 'var(--space-3)' }}>
        오늘 주문 {arming.ordersToday}건 · 상한 {arming.maxOrdersPerDay}건 · 계좌 {arming.env}
      </p>

      {arming.armed && arming.willDisarm && (
        <p role="status" style={{ fontSize: 'var(--fs-sm)', color: 'var(--nb-danger)', margin: 0, marginBottom: 'var(--space-3)' }}>
          멈추는 장치에 걸려 곧 풀립니다
        </p>
      )}

      {arming.blockedBy.length > 0 && (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 0, marginBottom: 'var(--space-3)' }}>
          막는 것: {arming.blockedBy.join(' · ')}
        </p>
      )}

      {arming.unknownOrders > 0 && (
        <p role="status" style={{ fontSize: 'var(--fs-sm)', color: 'var(--nb-danger)', margin: 0, marginBottom: 'var(--space-3)' }}>
          나갔는지 확인 못 한 주문이 {arming.unknownOrders}건 있습니다. 확인 전에는 새 주문을 내지 않습니다
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 'var(--space-2)', alignItems: 'center' }}>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
          무장 중에도 방향·수량·손절은 신호와 설정이 정한 대로만 나갑니다
          {arming.disarmLeavesOrders ? ' · 해제해도 이미 낸 주문은 남습니다' : ''}
        </span>
        {arming.armed ? (
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => toggle(false)}>
            <ShieldOff size={14} /> 해제
          </button>
        ) : (
          <button
            type="button" className="btn btn-sm"
            disabled={pending || !arming.canArm}
            title={arming.canArm ? undefined : arming.hint}
            onClick={() => toggle(true)}
          >
            <ShieldCheck size={14} /> 무장
          </button>
        )}
      </div>

      {message && (
        <p role="status" style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', margin: 0, marginTop: 'var(--space-3)' }}>
          {message}
        </p>
      )}
    </section>
  )
}
