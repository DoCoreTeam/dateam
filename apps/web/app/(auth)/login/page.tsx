import { signIn } from './actions'

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #eef2ff 0%, #f8fafc 60%, #e0e7ff 100%)',
        padding: '2rem',
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
          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              color: '#0f172a',
              letterSpacing: '-0.02em',
              margin: 0,
            }}
          >
            AX사업본부
          </h1>
          <p
            style={{
              fontSize: '0.875rem',
              color: '#64748b',
              marginTop: '0.375rem',
            }}
          >
            본부 운영 플랫폼
          </p>
        </div>

        {/* 카드 */}
        <div
          style={{
            backgroundColor: 'white',
            borderRadius: '1.25rem',
            padding: '2rem',
            boxShadow: '0 4px 24px rgb(0 0 0 / 0.08), 0 1px 3px rgb(0 0 0 / 0.05)',
            border: '1px solid #e2e8f0',
          }}
        >
          <h2
            style={{
              fontSize: '1.125rem',
              fontWeight: 600,
              color: '#0f172a',
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
                gap: '0.5rem',
                padding: '0.75rem 1rem',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '0.625rem',
                marginBottom: '1.25rem',
                fontSize: '0.8125rem',
                color: '#b91c1c',
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

          <form action={signIn} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
              style={{ marginTop: '0.5rem', width: '100%', padding: '0.75rem' }}
            >
              로그인
            </button>
          </form>
        </div>

        <p
          style={{
            textAlign: 'center',
            marginTop: '1.5rem',
            fontSize: '0.8125rem',
            color: '#94a3b8',
          }}
        >
          계정이 없다면 관리자에게 문의하세요
        </p>
      </div>
    </main>
  )
}
