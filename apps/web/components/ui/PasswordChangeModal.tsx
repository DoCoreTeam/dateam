'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { changePasswordAction, getOrgMemberNames, getMyProfileData } from '@/app/change-password/actions'
import NbModal from '@/components/ui/nb/NbModal'
import { withSubmitGuard } from '@/lib/forms/submit-guard'

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
    await withSubmitGuard(async () => {
      const result = await changePasswordAction(password, name)
      if (result.ok) {
        router.refresh()
      } else {
        setError(result.error)
        setPending(false)
      }
    }, { onError: setError, onDone: () => setPending(false) })
  }

  // 첫 로그인 강제 모달 — 닫을 수 없다(disableClose).
  // 예전엔 backdrop·카드를 직접 그렸고 `background: 'white'` 하드코딩 때문에
  // 다크 테마에서 이 모달만 흰색이었다. 무엇보다 `role="dialog"`가 없어
  // 스크린리더에는 존재하지 않는 화면이었다(v0.7.459 전수 점검).
  return (
    <NbModal onClose={() => {}} disableClose maxWidth={420} ariaLabel="첫 로그인 설정">
      <>
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
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-base)', margin: 0, lineHeight: 1.6 }}>
            본인 이름 확인 후 새 비밀번호를 설정해 주세요.
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
          {existingName ? (
            <div>
              <label className="label">이름</label>
              <div style={{ padding: '0.625rem 0.875rem', background: 'var(--color-bg)', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', fontSize: 'var(--fs-base)', color: 'var(--text)' }}>
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
      </>
    </NbModal>
  )
}
