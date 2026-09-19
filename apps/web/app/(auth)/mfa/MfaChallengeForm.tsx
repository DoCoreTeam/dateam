'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import NbButton from '@/components/ui/nb/NbButton'
import { ACTION, progress } from '@/lib/terms'
import { verifyChallenge, cancelChallenge } from './actions'

export default function MfaChallengeForm() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    start(async () => {
      const r = await verifyChallenge(code)
      if (!r.ok) { setError(r.error); setCode(''); return }
      // 이동은 화면이 한다 — 서버 액션이 redirect 하면 진행 표시가 안 꺼진다
      router.replace('/dashboard')
      router.refresh()
    })
  }

  function leave() {
    start(async () => {
      await cancelChallenge()
      router.replace('/login')
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div>
        <label className="label" htmlFor="code">인증 앱의 여섯 자리</label>
        <input
          id="code"
          name="code"
          className="input-field"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          style={{ letterSpacing: '0.4em', fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}
        />
      </div>

      {error && (
        <div role="alert" style={{ fontSize: '0.875rem', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <NbButton type="submit" variant="primary" disabled={pending || code.length !== 6}>
        {pending ? progress(ACTION.confirm) : ACTION.confirm}
      </NbButton>

      <NbButton type="button" variant="ghost" onClick={leave} disabled={pending}>
        다른 계정으로 로그인
      </NbButton>
    </form>
  )
}
