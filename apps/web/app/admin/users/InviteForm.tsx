'use client'

import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import { inviteUser } from './actions'

export default function InviteForm() {
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setResult(null)

    const form = e.currentTarget
    const formData = new FormData(form)
    const res = await inviteUser(formData)

    if (res.success) {
      setResult({ ok: true, msg: '구성원 계정이 생성되었습니다. 첫 로그인 시 비밀번호를 설정해야 합니다.' })
      form.reset()
    } else {
      setResult({ ok: false, msg: res.error ?? '오류가 발생했습니다' })
    }
    setPending(false)
  }

  return (
    <form onSubmit={handleSubmit}>
      {result && (
        <div style={{
          padding: '0.75rem 1rem',
          borderRadius: 'var(--radius)',
          marginBottom: '1rem',
          fontSize: '0.8125rem',
          backgroundColor: result.ok ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${result.ok ? '#bbf7d0' : '#fecaca'}`,
          color: result.ok ? '#15803d' : '#dc2626',
        }}>
          {result.msg}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
          <label className="label">이메일</label>
          <input name="email" type="email" required placeholder="team@example.com" className="input-field" />
        </div>
        <div style={{ flex: '1 1 100px', minWidth: 0 }}>
          <label className="label">이름</label>
          <input name="name" type="text" required placeholder="홍길동" className="input-field" />
        </div>
        <button type="submit" className="btn-primary" disabled={pending} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
          <UserPlus size={14} />
          {pending ? '생성 중...' : '계정 생성'}
        </button>
      </div>
      <p style={{ marginTop: '0.625rem', fontSize: '0.75rem', color: '#94a3b8' }}>
        계정 생성 후 구성원은 비밀번호 빈칸으로 첫 로그인하여 새 비밀번호를 설정합니다.
      </p>
    </form>
  )
}
