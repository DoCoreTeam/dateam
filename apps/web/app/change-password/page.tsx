import { createClient, createAdminClient } from '@/lib/supabase/server'
import { changePassword, getOrgMemberNames } from './actions'
import type { Profile } from '@/types/database'

interface PageProps {
  searchParams: Promise<{ error?: string }>
}

export default async function ChangePasswordPage({ searchParams }: PageProps) {
  const { error } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let currentName: string | null = null
  let availableNames: string[] = []

  if (user) {
    const adminClient = createAdminClient()
    const { data: profile } = await adminClient
      .from('profiles')
      .select('name')
      .eq('id', user.id)
      .single() as unknown as { data: Pick<Profile, 'name'> | null }

    currentName = profile?.name ?? null

    if (!currentName) {
      availableNames = await getOrgMemberNames()
    }
  }

  const needsName = !currentName

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #f0f4ff 0%, #fafafa 100%)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          background: 'white',
          borderRadius: 'var(--radius)',
          padding: '2.5rem',
          boxShadow: '0 4px 24px rgb(0 0 0 / 0.08)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
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
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
            비밀번호 변경
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '0.5rem', lineHeight: 1.6 }}>
            새 비밀번호를 설정해 주세요.
          </p>
        </div>

        {error && (
          <div
            style={{
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 'var(--radius)',
              padding: '0.75rem 1rem',
              marginBottom: '1rem',
              fontSize: '0.875rem',
              color: '#dc2626',
            }}
          >
            {error}
          </div>
        )}

        <form action={changePassword} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {needsName && (
            <div>
              <label htmlFor="name" className="label">
                내 이름 <span style={{ color: '#dc2626' }}>*</span>
              </label>
              {availableNames.length > 0 ? (
                <select
                  id="name"
                  name="name"
                  required
                  className="input-field"
                  style={{ width: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
                  defaultValue=""
                >
                  <option value="" disabled>조직도에서 내 이름 선택</option>
                  {availableNames.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              ) : (
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  placeholder="실명 입력 (조직도에 등록된 이름)"
                  className="input-field"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              )}
              <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.375rem' }}>
                조직도에 등록된 이름과 일치해야 합니다
              </p>
            </div>
          )}

          <div>
            <label htmlFor="password" className="label">새 비밀번호</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              placeholder="8자 이상 입력"
              className="input-field"
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label htmlFor="confirm" className="label">비밀번호 확인</label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              required
              placeholder="동일한 비밀번호 입력"
              className="input-field"
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>
          <button
            type="submit"
            className="btn-primary"
            style={{ marginTop: '0.5rem', width: '100%' }}
          >
            변경하고 시작하기
          </button>
        </form>
      </div>
    </div>
  )
}
