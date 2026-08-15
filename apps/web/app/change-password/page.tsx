import { createClient, createAdminClient, getRequestUser } from '@/lib/supabase/server'
import PageHeader from '@/components/ui/PageHeader'
import ErrorState from '@/components/ui/ErrorState'
import { changePassword, getOrgMemberNames } from './actions'
import type { Profile } from '@/types/database'

interface PageProps {
  searchParams: Promise<{ error?: string }>
}

export default async function ChangePasswordPage({ searchParams }: PageProps) {
  const { error } = await searchParams

  const supabase = await createClient()
  const user = await getRequestUser()

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
        background: 'linear-gradient(135deg, var(--brand-soft) 0%, var(--surface-bg) 100%)',
        padding: 'var(--space-4)',
      }}
    >
      {/* 카드 — 표면·보더·그림자는 .card(SSOT) */}
      <div className="card" style={{ width: '100%', maxWidth: '420px', padding: 'var(--space-10)' }}>
        <div
          style={{
            width: '3rem',
            height: '3rem',
            background: 'linear-gradient(135deg, var(--brand), var(--brand-dark))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 0 var(--space-4)',
            fontSize: '1.375rem',
          }}
        >
          🔒
        </div>

        <PageHeader title="비밀번호 변경" description="새 비밀번호를 설정해 주세요." />

        {error && (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <ErrorState message={error} />
          </div>
        )}

        <form action={changePassword} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {needsName && (
            <div>
              <label htmlFor="name" className="label">
                내 이름 <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              {availableNames.length > 0 ? (
                <select className="input-field" id="name" name="name" required defaultValue="" style={{ cursor: 'pointer' }}>
                  <option value="" disabled>조직도에서 내 이름 선택</option>
                  {availableNames.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              ) : (
                <input className="input-field" id="name" name="name" type="text" required placeholder="실명 입력 (조직도에 등록된 이름)" />
              )}
              <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: '0.375rem' }}>
                조직도에 등록된 이름과 일치해야 합니다
              </p>
            </div>
          )}

          <div>
            <label htmlFor="password" className="label">새 비밀번호</label>
            <input className="input-field" id="password" name="password" type="password" required minLength={8} placeholder="8자 이상 입력" />
          </div>
          <div>
            <label htmlFor="confirm" className="label">비밀번호 확인</label>
            <input className="input-field" id="confirm" name="confirm" type="password" required placeholder="동일한 비밀번호 입력" />
          </div>
          <button type="submit" className="btn-primary" style={{ marginTop: 'var(--space-2)', width: '100%' }}>
            변경하고 시작하기
          </button>
        </form>
      </div>
    </div>
  )
}
