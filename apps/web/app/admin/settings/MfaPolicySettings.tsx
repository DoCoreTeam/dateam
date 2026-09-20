'use client'

import { useState, useTransition } from 'react'
import { ShieldCheck } from 'lucide-react'
import SettingsCard from '@/components/ui/settings/SettingsCard'
import { saveMfaRequiredForAdmin } from './actions'

interface Props {
  enabled: boolean
  /** 지금 2단계를 켠 관리자 수 / 전체 관리자 수 */
  adminsWithMfa: number
  adminsTotal: number
}

/**
 * 관리자에게 2단계 인증을 요구할지 정하는 스위치
 *
 * 켜면 **막는 것이 아니라 등록 화면으로 보낸다.** 막으면 관리자가 자기 시스템에서 잠긴다.
 * 그래서 아직 아무도 안 켰을 때 켜도 안전하다.
 */
export default function MfaPolicySettings({ enabled, adminsWithMfa, adminsTotal }: Props) {
  const [on, setOn] = useState(enabled)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  function toggle(next: boolean) {
    setMsg(null)
    start(async () => {
      const result = await saveMfaRequiredForAdmin(next)
      if (result.ok) {
        setOn(next)
        setMsg({ ok: true, text: next ? '이제 관리자는 2단계 인증을 등록해야 합니다' : '요구하지 않도록 바꿨습니다' })
      } else {
        setMsg({ ok: false, text: result.error ?? '저장 실패' })
      }
    })
  }

  const allCovered = adminsWithMfa >= adminsTotal && adminsTotal > 0

  return (
    <SettingsCard title="관리자 2단계 인증" headingLevel={2} icon={<ShieldCheck size={16} />}>
      <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', marginTop: 0, marginBottom: '1rem' }}>
        켜면 2단계 인증을 등록하지 않은 관리자는 다른 화면으로 가기 전에 등록 화면을 지나게 됩니다.
        내쫓지 않으므로 지금 켜도 아무도 잠기지 않습니다.
      </p>

      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          padding: 'var(--space-3)', background: 'var(--surface-muted)', marginBottom: '1rem',
        }}
      >
        <span style={{ fontSize: 'var(--fs-sm)', color: allCovered ? 'var(--success)' : 'var(--warning)', fontWeight: 700 }}>
          {adminsWithMfa} / {adminsTotal}
        </span>
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          {allCovered ? '관리자 모두 등록했습니다' : '아직 등록하지 않은 관리자가 있습니다'}
        </span>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: pending ? 'wait' : 'pointer' }}>
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          onChange={(e) => toggle(e.target.checked)}
        />
        <span style={{ fontSize: 'var(--fs-base)' }}>관리자에게 2단계 인증을 요구</span>
      </label>

      {msg && (
        <p style={{ marginTop: 'var(--space-3)', marginBottom: 0, fontSize: 'var(--fs-sm)', color: msg.ok ? 'var(--success)' : 'var(--danger)' }}>
          {msg.text}
        </p>
      )}
    </SettingsCard>
  )
}
