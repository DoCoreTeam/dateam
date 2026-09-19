import { redirect } from 'next/navigation'
import { getMfaState, needsChallenge } from '@/lib/auth/mfa'
import { getRequestUser } from '@/lib/supabase/server'
import PageHeader from '@/components/ui/PageHeader'
import MfaChallengeForm from './MfaChallengeForm'

export const dynamic = 'force-dynamic'

export default async function MfaPage() {
  const user = await getRequestUser()
  if (!user) redirect('/login')

  // 이미 통과했거나 애초에 필요 없는 사람이 이 화면에 머물지 않게 한다.
  const state = await getMfaState()
  if (!needsChallenge(state)) redirect('/dashboard')

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
      <div className="card" style={{ width: '100%', maxWidth: '380px', padding: 'var(--space-10)' }}>
        {/* 제목은 PageHeader 로만 그린다 — 로그인 화면과 같은 부품 (screen-standard 가드) */}
        <PageHeader
          title="한 걸음 남았습니다"
          description="등록하신 인증 앱에 나오는 여섯 자리 숫자를 넣어 주세요. 숫자는 30초마다 바뀝니다."
        />
        <MfaChallengeForm />
      </div>
    </div>
  )
}
