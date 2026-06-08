import { signIn } from './actions'
import { getBranding } from '@/lib/branding'

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [{ error }, branding] = await Promise.all([
    searchParams,
    getBranding(),
  ])

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, var(--brand-soft) 0%, var(--color-bg) 60%, var(--brand-soft-2) 100%)',
        padding: 'clamp(1rem, 5vw, 2rem)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '400px',
        }}
      >
        {/* 로고 영역 */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logoUrl}
              alt={branding.brandName}
              style={{ maxHeight: '64px', maxWidth: '240px', objectFit: 'contain', margin: '0 auto 0.5rem' }}
            />
          ) : (
            <h1
              style={{
                fontSize: 'var(--fs-2xl)',
                fontWeight: 700,
                color: 'var(--text)',
                letterSpacing: '-0.02em',
                margin: 0,
              }}
            >
              {branding.brandName}
            </h1>
          )}
          {branding.tagline && (
            <p
              style={{
                fontSize: 'var(--fs-base)',
                color: 'var(--text-muted)',
                marginTop: '0.375rem',
              }}
            >
              {branding.tagline}
            </p>
          )}
        </div>

        {/* 카드 */}
        <div
          style={{
            backgroundColor: 'white',
            borderRadius: 'var(--radius)',
            padding: 'var(--space-8)',
            boxShadow: '0 4px 24px rgb(0 0 0 / 0.08), 0 1px 3px rgb(0 0 0 / 0.05)',
            border: 'var(--border-w-2) solid var(--border-color)',
          }}
        >
          <h2
            style={{
              fontSize: 'var(--fs-xl)',
              fontWeight: 600,
              color: 'var(--text)',
              marginBottom: '1.5rem',
              letterSpacing: '-0.01em',
            }}
          >
            로그인
          </h2>

          {error && (
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
              {decodeURIComponent(error)}
            </div>
          )}

          <form action={signIn} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div>
              <label htmlFor="email" className="label">이메일</label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="team@example.com"
                className="input-field"
              />
            </div>

            <div>
              <label htmlFor="password" className="label">비밀번호</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="비밀번호 (초기화된 경우 빈칸으로 로그인)"
                className="input-field"
              />
            </div>

            <button
              type="submit"
              className="btn-primary"
              style={{ marginTop: '0.5rem', width: '100%', padding: 'var(--space-3)' }}
            >
              로그인
            </button>
          </form>
        </div>

        <p
          style={{
            textAlign: 'center',
            marginTop: '1.5rem',
            fontSize: 'var(--fs-sm)',
            color: 'var(--text-faint)',
          }}
        >
          계정이 없다면 관리자에게 문의하세요
        </p>
      </div>
    </main>
  )
}
