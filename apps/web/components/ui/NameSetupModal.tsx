'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { setProfileNameAction, getOrgMemberNames } from '@/app/change-password/actions'
import NbModal from '@/components/ui/nb/NbModal'
import { withSubmitGuard } from '@/lib/forms/submit-guard'

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
    await withSubmitGuard(async () => {
      const result = await setProfileNameAction(name)
      if (result.ok) {
        router.refresh()
      } else {
        setError(result.error)
        setPending(false)
      }
    }, { onError: setError, onDone: () => setPending(false) })
  }

  // 이름 설정 강제 모달 — 닫을 수 없다. PasswordChangeModal과 같은 사고였다:
  // 자작 backdrop + `background: 'white'` 하드코딩 + role 없음(v0.7.459).
  return (
    <NbModal onClose={() => {}} disableClose maxWidth={380} ariaLabel="이름 설정">
      <>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div
            style={{
              width: '3rem',
              height: '3rem',
              borderRadius: 'var(--radius)',
              background: 'linear-gradient(135deg, var(--info), var(--info))',
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
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-base)', margin: 0, lineHeight: 1.6 }}>
            조직도에서 본인 이름을 선택해 주세요.
          </p>
        </div>

        {error && (
          <div
            style={{
              backgroundColor: 'var(--danger-bg)',
              border: 'var(--hairline) solid var(--danger-border)',
              borderRadius: 'var(--radius)',
              padding: 'var(--space-3) var(--space-4)',
              marginBottom: '1rem',
              fontSize: 'var(--fs-sm)',
              color: 'var(--danger)',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
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
      </>
    </NbModal>
  )
}
