'use client'

import { useState, useTransition } from 'react'
import { ShieldCheck, ShieldAlert, Smartphone, Trash2 } from 'lucide-react'
import { ACTION, progress } from '@/lib/terms'
import { startEnroll, confirmEnroll, removeFactor } from './actions'
import type { MfaFactor } from '@/lib/auth/mfa'

interface Props {
  verified: MfaFactor[]
  isAdmin: boolean
  requiredForAdmin: boolean
}

/**
 * 2단계 인증 등록 화면
 *
 * 화면이 세 상태만 갖는다: 아직 안 씀 / 등록하는 중(QR 표시) / 쓰는 중.
 * 상태를 늘리면 사람이 자기가 어디 있는지 모른다.
 */
export default function MfaPanel({ verified, isAdmin, requiredForAdmin }: Props) {
  const [setup, setSetup] = useState<{ factorId: string; qr: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const active = verified.length > 0

  function begin() {
    setError(null)
    start(async () => {
      const r = await startEnroll()
      if (!r.ok) { setError(r.error); return }
      setSetup({ factorId: r.factorId, qr: r.qr, secret: r.secret })
    })
  }

  function finish() {
    setError(null)
    start(async () => {
      if (!setup) return
      const r = await confirmEnroll(setup.factorId, code)
      if (!r.ok) { setError(r.error); return }
      setSetup(null)
      setCode('')
    })
  }

  function drop(factorId: string) {
    setError(null)
    start(async () => {
      const r = await removeFactor(factorId)
      if (!r.ok) setError(r.error)
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div
        className="card"
        style={{ padding: 'var(--space-6)', display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start' }}
      >
        <div style={{ color: active ? 'var(--success)' : 'var(--warning)', marginTop: 2 }}>
          {active ? <ShieldCheck size={22} /> : <ShieldAlert size={22} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, marginBottom: 'var(--space-1)' }}>
            {active ? '2단계 인증을 쓰고 있습니다' : '2단계 인증을 쓰고 있지 않습니다'}
          </div>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
            {active
              ? '로그인할 때 비밀번호와 함께 휴대폰 앱의 숫자를 입력합니다. 비밀번호가 새도 그것만으로는 들어올 수 없습니다.'
              : '지금은 비밀번호 하나만 알면 누구나 들어올 수 있습니다. 휴대폰 인증 앱을 등록하면 비밀번호가 새도 막힙니다.'}
          </p>
          {isAdmin && !active && requiredForAdmin && (
            <p style={{ margin: 'var(--space-2) 0 0', fontSize: '0.875rem', color: 'var(--danger)' }}>
              관리자 계정은 등록이 필요합니다. 등록을 마칠 때까지 다른 화면으로 넘어갈 수 없습니다.
            </p>
          )}
        </div>
      </div>

      {active && (
        <div className="card" style={{ padding: 'var(--space-6)' }}>
          <div style={{ fontWeight: 700, marginBottom: 'var(--space-3)' }}>등록된 장치</div>
          {verified.map((f) => (
            <div
              key={f.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                padding: 'var(--space-3) 0', borderTop: '1px solid var(--color-border)',
              }}
            >
              <Smartphone size={16} style={{ color: 'var(--text-muted)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.875rem' }}>{f.friendlyName || '인증 앱'}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {new Date(f.createdAt).toLocaleDateString('ko-KR')} 등록
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm nb-danger"
                onClick={() => drop(f.id)}
                disabled={pending}
              >
                <Trash2 size={13} /> {pending ? progress(ACTION.delete) : ACTION.delete}
              </button>
            </div>
          ))}
          <p style={{ margin: 'var(--space-3) 0 0', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            휴대폰을 잃어버렸다면 관리자에게 알려 주세요. 관리자가 장치를 떼 주면 비밀번호로 다시 들어와 새로 등록할 수 있습니다.
          </p>
        </div>
      )}

      {!active && !setup && (
        <div>
          <button type="button" className="btn btn-primary" onClick={begin} disabled={pending}>
            {pending ? '준비하는 중…' : '2단계 인증 등록'}
          </button>
        </div>
      )}

      {setup && (
        <div className="card" style={{ padding: 'var(--space-6)' }}>
          <div style={{ fontWeight: 700, marginBottom: 'var(--space-2)' }}>휴대폰 앱으로 아래 그림을 찍으세요</div>
          <p style={{ margin: '0 0 var(--space-4)', fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
            Google Authenticator, 1Password, Authy 같은 인증 앱이면 무엇이든 됩니다.
            찍고 나면 앱에 여섯 자리 숫자가 나타나고, 그 숫자를 아래에 넣어야 등록이 끝납니다.
          </p>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={setup.qr}
            alt="인증 앱으로 찍을 QR 코드"
            width={200}
            height={200}
            style={{ display: 'block', background: 'var(--nb-white)', padding: 'var(--space-2)' }}
          />

          <details style={{ margin: 'var(--space-3) 0' }}>
            <summary style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
              그림을 찍을 수 없을 때
            </summary>
            <code
              style={{
                display: 'block', marginTop: 'var(--space-2)', padding: 'var(--space-2)',
                background: 'var(--surface-muted)', fontSize: '0.8125rem', wordBreak: 'break-all',
              }}
            >
              {setup.secret}
            </code>
          </details>

          <label className="label" htmlFor="mfa-code">앱에 나온 여섯 자리</label>
          <input
            id="mfa-code"
            className="input-field"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            style={{ maxWidth: '10rem', letterSpacing: '0.3em', fontVariantNumeric: 'tabular-nums' }}
          />

          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
            <button type="button" className="btn btn-primary" onClick={finish} disabled={pending || code.length !== 6}>
              {pending ? progress(ACTION.confirm) : ACTION.confirm}
            </button>
            <button type="button" className="btn" onClick={() => { setSetup(null); setCode(''); setError(null) }} disabled={pending}>
              {ACTION.cancel}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            padding: 'var(--space-3)', background: 'var(--danger-bg)',
            color: 'var(--danger)', fontSize: '0.875rem',
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}
