import LoginForm from './LoginForm'
import { getBranding } from '@/lib/branding'

export default async function LoginPage() {
  const branding = await getBranding()

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

          <LoginForm brandName={branding.brandName} logoUrl={branding.logoUrl} />
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
