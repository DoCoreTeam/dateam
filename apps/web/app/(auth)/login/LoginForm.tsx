'use client'

import { useEffect, useRef } from 'react'
import { useFormStatus, useFormState } from 'react-dom'
import { signIn, type SignInState } from './actions'
import AXLoadingOverlay from '@/components/ui/AXLoadingOverlay'

const INITIAL: SignInState = {}

// 제출 버튼 — pending 동안 비활성 + 라벨 전환 (useFormStatus는 form 내부에서만 동작)
function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      className="btn-primary"
      disabled={pending}
      aria-busy={pending}
      style={{ marginTop: '0.5rem', width: '100%', padding: 'var(--space-3)', opacity: pending ? 0.85 : 1 }}
    >
      {pending ? '로그인 중…' : '로그인'}
    </button>
  )
}

// 제출 중 전체화면 로딩 오버레이 — 공용 로고 스피너(SSOT). 로고 있으면 이미지, 없으면 X마크.
function PendingOverlay({ brandName, logoUrl }: { brandName: string; logoUrl?: string | null }) {
  const { pending } = useFormStatus()
  return (
    <AXLoadingOverlay
      isLoading={pending}
      brandName={brandName}
      logoUrl={logoUrl}
      label="로그인 중…"
      ariaLabel="로그인 처리 중"
    />
  )
}

interface LoginFormProps {
  /** 로딩 오버레이에 표시할 회사 브랜드명 */
  brandName: string
  /** 등록된 브랜드 로고 이미지 (없으면 X마크) */
  logoUrl?: string | null
}

// 로그인 폼 — 에러를 useActionState 상태로 받는다(URL ?error= 미사용).
// 새로고침하면 상태가 초기화되어 에러가 재출현하지 않음(1회성). 실패 시 이메일 prefill + 비번칸 포커스.
export default function LoginForm({ brandName, logoUrl }: LoginFormProps) {
  // React 18: useFormState(react-dom). React 19의 useActionState와 동일 시그니처.
  const [state, formAction] = useFormState(signIn, INITIAL)
  const passwordRef = useRef<HTMLInputElement>(null)

  // 로그인 실패(에러) 시 → 비밀번호 입력칸으로 커서 이동해 바로 재입력
  useEffect(() => {
    if (state.error) passwordRef.current?.focus()
  }, [state.error])

  return (
    <>
      {state.error && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-3) var(--space-4)',
            backgroundColor: 'var(--danger-bg)',
            border: 'var(--hairline) solid var(--danger-border)',
            borderRadius: 'var(--radius)',
            marginBottom: '1.25rem',
            fontSize: 'var(--fs-sm)',
            color: 'var(--danger)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {state.error}
        </div>
      )}

      <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div>
          <label htmlFor="email" className="label">이메일</label>
          <input className="input-field"
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            autoFocus={!state.error}
            defaultValue={state.email ?? ''}
            placeholder="team@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="label">비밀번호</label>
          <input className="input-field"
            ref={passwordRef}
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="비밀번호 (초기화된 경우 빈칸으로 로그인)"
          />
        </div>

        <SubmitButton />
        <PendingOverlay brandName={brandName} logoUrl={logoUrl} />
      </form>
    </>
  )
}
