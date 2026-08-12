import LoginForm from './LoginForm'
import PageHeader from '@/components/ui/PageHeader'
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
        {/* 브랜드 마크 — 페이지 제목(h1)은 카드 안의 PageHeader가 맡는다 */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logoUrl}
              alt={branding.brandName}
              style={{ maxHeight: '64px', maxWidth: '240px', objectFit: 'contain', margin: '0 auto 0.5rem' }}
            />
          ) : (
            <p
              style={{
                fontSize: 'var(--fs-2xl)',
                fontWeight: 700,
                color: 'var(--text)',
                letterSpacing: '-0.02em',
                margin: 0,
              }}
            >
              {branding.brandName}
            </p>
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

        {/* 카드 — 표면·보더·그림자는 .card(SSOT) */}
        <div className="card" style={{ padding: 'var(--space-8)' }}>
          <PageHeader title="로그인" />

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
