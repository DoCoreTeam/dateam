import { redirect } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import { getRequestUser, createAdminClient } from '@/lib/supabase/server'
import { getMfaState, isMfaRequiredForAdmin } from '@/lib/auth/mfa'
import MfaPanel from './MfaPanel'

/**
 * 보안 설정 화면
 *
 * `(member)` 셸 밖에 둔다. 관리자에게 2단계를 요구하는 동안에는 이 화면 말고
 * 갈 수 있는 곳이 없어야 하는데, 셸 안에 두면 사이드바로 다른 곳에 갈 수 있다.
 */
export const dynamic = 'force-dynamic'

export default async function SecurityPage() {
  const user = await getRequestUser()
  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const [{ data: profile }, state, requiredForAdmin] = await Promise.all([
    admin.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    getMfaState(),
    isMfaRequiredForAdmin(),
  ])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface-bg)', padding: 'var(--space-6)' }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
        <PageHeader
          title="보안"
          icon={<ShieldCheck size={20} />}
          description="로그인에 한 겹을 더합니다"
          back={{ href: '/dashboard', label: '대시보드' }}
        />
        <MfaPanel
          verified={state.verified}
          isAdmin={profile?.role === 'admin'}
          requiredForAdmin={requiredForAdmin}
        />
      </div>
    </div>
  )
}
