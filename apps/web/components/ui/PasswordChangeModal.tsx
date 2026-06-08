'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { changePasswordAction, getOrgMemberNames, getMyProfileData } from '@/app/change-password/actions'

export default function PasswordChangeModal() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [memberNames, setMemberNames] = useState<string[]>([])
  const [existingName, setExistingName] = useState<string | null>(null)

  useEffect(() => {
    getMyProfileData().then(({ name: profileName, isOrgMember }) => {
      if (profileName && !isOrgMember) {
        // 외부 API 사용자 — 이름 이미 설정됨, 이름 선택 단계 생략
        setExistingName(profileName)
        setName(profileName)
      } else {
        // 내부 직원 — 조직도에서 이름 선택
        getOrgMemberNames().then(setMemberNames)
      }
    })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!name.trim()) {
      setError('이름을 선택해 주세요')
      return
    }
    if (password.length < 8) {
      setError('비밀번호는 8자 이상이어야 합니다')
      return
    }
    if (password !== confirm) {
      setError('비밀번호가 일치하지 않습니다')
      return
    }

    setPending(true)
    const result = await changePasswordAction(password, name)
    if (result.ok) {
      router.refresh()
    } else {
      setError(result.error)
      setPending(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(15, 23, 42, 0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          background: 'white',
          borderRadius: 'var(--radius)',
          padding: '2.5rem',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.2)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div
            style={{
              width: '3rem',
              height: '3rem',
              borderRadius: 'var(--radius)',
              background: 'linear-gradient(135deg, var(--brand), var(--brand-dark))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem',
              fontSize: '1.375rem',
            }}
          >
            🔒
          </div>
          <h2 className="tape-title" style={{ margin: 0 }}>
            첫 로그인 설정
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0, lineHeight: 1.6 }}>
            본인 이름 확인 후 새 비밀번호를 설정해 주세요.
          </p>
        </div>

        {error && (
          <div
            style={{
              backgroundColor: 'var(--danger-bg)',
              border: '1px solid var(--danger-border)',
              borderRadius: 'var(--radius)',
              padding: '0.75rem 1rem',
              marginBottom: '1rem',
              fontSize: '0.8125rem',
              color: 'var(--danger)',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {existingName ? (
            <div>
              <label className="label">이름</label>
              <div style={{ padding: '0.625rem 0.875rem', background: 'var(--color-bg)', border: '2px solid var(--border-color)', borderRadius: 'var(--radius)', fontSize: '0.875rem', color: 'var(--text)' }}>
                {existingName}
              </div>
            </div>
          ) : (
            <div>
              <label htmlFor="pw-name" className="label">본인 이름 (조직도 기준)</label>
              <select
                id="pw-name"
                required
                className="input-field"
                style={{ width: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
                value={name}
                onChange={(e) => setName(e.target.value)}
              >
                <option value="">이름 선택...</option>
                {memberNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="pw-new" className="label">새 비밀번호</label>
            <input
              id="pw-new"
              type="password"
              required
              minLength={8}
              placeholder="8자 이상"
              className="input-field"
              style={{ width: '100%', boxSizing: 'border-box' }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="pw-confirm" className="label">비밀번호 확인</label>
            <input
              id="pw-confirm"
              type="password"
              required
              placeholder="동일한 비밀번호 입력"
              className="input-field"
              style={{ width: '100%', boxSizing: 'border-box' }}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn-primary"
            disabled={pending}
            style={{ marginTop: '0.5rem', width: '100%' }}
          >
            {pending ? '저장 중...' : '설정 완료'}
          </button>
        </form>
      </div>
    </div>
  )
}
