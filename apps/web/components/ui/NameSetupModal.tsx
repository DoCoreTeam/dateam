'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { setProfileNameAction, getOrgMemberNames } from '@/app/change-password/actions'

export default function NameSetupModal() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [memberNames, setMemberNames] = useState<string[]>([])

  useEffect(() => {
    getOrgMemberNames().then(setMemberNames)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!name.trim()) {
      setError('이름을 선택해 주세요')
      return
    }

    setPending(true)
    const result = await setProfileNameAction(name)
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
          maxWidth: '380px',
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
              background: 'linear-gradient(135deg, #0ea5e9, #0284c7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem',
              fontSize: '1.375rem',
            }}
          >
            👤
          </div>
          <h2 className="tape-title" style={{ margin: 0 }}>
            본인 확인
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0, lineHeight: 1.6 }}>
            조직도에서 본인 이름을 선택해 주세요.
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
          <div>
            <label htmlFor="name-select" className="label">본인 이름</label>
            <select
              id="name-select"
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
          <button
            type="submit"
            className="btn-primary"
            disabled={pending}
            style={{ width: '100%' }}
          >
            {pending ? '저장 중...' : '확인'}
          </button>
        </form>
      </div>
    </div>
  )
}
