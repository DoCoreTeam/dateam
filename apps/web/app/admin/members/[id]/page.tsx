import { notFound, redirect } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import { createAdminClient, getRequestUser } from '@/lib/supabase/server'
import { isResigned, type EmploymentRow } from '@/lib/members/employment'
import { EMPLOYMENT_STATUS } from '@/lib/terms'
import MemberFacts from './MemberFacts'
import EmploymentCard from './EmploymentCard'
import MemberActions from './MemberActions'
import type { MemberEmployment, Profile } from '@/types/database'

export const metadata = { title: '구성원 상세 | 어드민' }

/**
 * 구성원 상세 — 목록과 조직도가 **같은 곳**으로 온다.
 *
 * 왜 화면이 따로 필요했나: 지금까지 사람을 눌러 볼 수 있는 자리가 없었다. 목록은 행을 죽여
 * 두었고 조직도의 연필은 「상위 노드 변경」 하나뿐인 창을 열어, 그 사람에 대해 아는 것을
 * 한 자리에서 볼 방법이 없었다 (사용자 지적 2026-09-17).
 */
export default async function MemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getRequestUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = adminClient as any

  const { data: me } = await db.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') redirect('/dashboard')

  const [profileRes, employmentRes, nodeRes, nodesRes, ranksRes, positionsRes] = await Promise.all([
    db.from('profiles').select('*').eq('id', id).maybeSingle(),
    db.from('member_employment').select('*').eq('user_id', id).maybeSingle(),
    db.from('org_nodes').select('id, parent_id').eq('type', 'person').eq('user_id', id).maybeSingle(),
    // 소속으로 고를 수 있는 것 — 사람 노드는 뺀다(사람 아래에 사람을 넣지 않는다)
    db.from('org_nodes').select('id, name, type').neq('type', 'person').order('display_order').order('name'),
    db.from('org_ranks').select('id, name, display_order').order('display_order'),
    db.from('org_positions').select('id, name, display_order').order('display_order'),
  ])

  const profile = profileRes.data as Profile | null
  if (!profile) notFound()

  const employment = (employmentRes.data ?? null) as MemberEmployment | null

  // 소속은 사람 노드의 부모다. 노드가 없으면(퇴사했거나 아직 안 넣었으면) 소속도 없다
  const departmentId = (nodeRes.data?.parent_id as string | null) ?? null
  const departments = (nodesRes.data ?? []) as { id: string; name: string }[]
  const ranks = (ranksRes.data ?? []) as { id: number; name: string; display_order: number }[]
  const positions = (positionsRes.data ?? []) as { id: number; name: string; display_order: number }[]

  const { data: authUser } = await adminClient.auth.admin.getUserById(id)
  const email = authUser?.user?.email ?? ''
  const resigned = isResigned(employment as EmploymentRow | null)

  return (
    <div>
      <PageHeader
        title={profile.name || '이름 없음'}
        back={{ href: '/admin/members?tab=users', label: '구성원 관리' }}
        description={email}
        titleAfter={resigned
          ? <span className="badge badge-slate" title={EMPLOYMENT_STATUS.resigned.meaning}>{EMPLOYMENT_STATUS.resigned.label}</span>
          : undefined}
      />

      <MemberFacts
        profile={profile}
        email={email}
        departmentId={departmentId}
        departments={departments}
        ranks={ranks}
        positions={positions}
        isSelf={profile.id === user.id}
      />

      <EmploymentCard
        userId={profile.id}
        userName={profile.name || '이름 없음'}
        isSelf={profile.id === user.id}
        employment={employment}
      />

      <MemberActions
        userId={profile.id}
        userName={profile.name || '이름 없음'}
        userEmail={email}
        isSelf={profile.id === user.id}
        isResigned={resigned}
      />
    </div>
  )
}
