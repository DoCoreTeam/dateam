import { redirect } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { createClient, createAdminClient, getRequestUser } from '@/lib/supabase/server'
import { Users, UserPlus, UserMinus } from 'lucide-react'
import InviteForm from '../users/InviteForm'
import UserTable from '../users/UserTable'
import CompanyForm from '../org-chart/CompanyForm'
import OrgTree from '../org-chart/OrgTree'
import RankPositionManager from '../org-chart/RankPositionManager'
import type { OrgNode } from '../org-chart/OrgNodeCard'
import { activeMembers } from '@/lib/members/resigned-server'
import { employmentMap, isResigned, type EmploymentRow } from '@/lib/members/employment'
import { RESIGNED_TAB } from '@/lib/terms'
import type { Profile } from '@/types/database'

export const metadata = { title: '구성원 관리 | 어드민' }

/**
 * 퇴사자가 별도 탭인 이유 (사용자 지적 2026-09-18): 목록 기본 정렬이 이름순이라 퇴사자가
 * 재직자 사이사이에 끼어 나온다. 이름을 훑는 일이 그때마다 끊긴다.
 * 거르개로 두면 «눌러야 동작하는 것» 이 되는데, 여기서 필요한 것은 **기본이 재직자**인 목록이다.
 */
const TABS = [
  { key: 'users', label: '사용자 관리' },
  { key: 'resigned', label: RESIGNED_TAB.label },
  { key: 'org', label: '조직도 관리' },
  { key: 'ranks', label: '직급·직책' },
] as const
type Tab = typeof TABS[number]['key']

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const supabase = await createClient()
  const user = await getRequestUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = adminClient as any

  const params = await searchParams
  const tab: Tab = (TABS.map(t => t.key) as string[]).includes(params.tab ?? '') ? (params.tab as Tab) : 'users'

  // 공통 데이터
  const [ranksRes, positionsRes] = await Promise.all([
    db.from('org_ranks').select('id, name, display_order').order('display_order'),
    db.from('org_positions').select('id, name, display_order').order('display_order'),
  ])
  const ranks = (ranksRes.data ?? []) as { id: number; name: string; display_order: number }[]
  const positions = (positionsRes.data ?? []) as { id: number; name: string; display_order: number }[]

  // 탭별 추가 데이터
  let activeProfiles: Profile[] = []
  let resignedProfiles: Profile[] = []
  let employment: EmploymentRow[] = []
  let emailMap: Record<string, string> = {}
  let orgCompany: { name: string; description: string | null } | null = null
  let orgNodes: OrgNode[] = []
  let orgProfiles: { id: string; name: string; rank: string | null; position: string | null; email?: string | null }[] = []

  // 두 탭이 같은 데이터를 갈라 쓴다 — 탭마다 따로 읽으면 세는 기준이 갈릴 수 있다
  if (tab === 'users' || tab === 'resigned') {
    const [profilesRes, authUsersRes, employmentRes] = await Promise.all([
      db.from('profiles').select('*').is('deleted_at', null).order('created_at', { ascending: true }),
      adminClient.auth.admin.listUsers({ perPage: 1000 }),
      db.from('member_employment').select('user_id, hired_on, resigned_on'),
    ])
    employment = (employmentRes.data ?? []) as EmploymentRow[]
    const empMap = employmentMap(employment)
    for (const p of (profilesRes.data ?? []) as Profile[]) {
      if (isResigned(empMap.get(p.id))) resignedProfiles.push(p)
      else activeProfiles.push(p)
    }
    emailMap = Object.fromEntries(
      (authUsersRes.data?.users ?? []).map((u: { id: string; email?: string }) => [u.id, u.email ?? ''])
    )
  }

  if (tab === 'org') {
    const [companyRes, nodesRes, profilesRes, emailRes] = await Promise.all([
      db.from('org_company').select('name, description').eq('id', 1).single(),
      db.from('org_nodes').select('id, type, parent_id, name, subtitle, display_order, head_user_id, user_id, color').order('display_order').order('id'),
      db.from('profiles').select('id, name, rank, position').is('deleted_at', null).order('name'),
      db.rpc('get_user_emails'),
    ])
    orgCompany = companyRes.data as { name: string; description: string | null } | null
    orgNodes = (nodesRes.data ?? []) as OrgNode[]
    const rawEmailMap: Record<string, string> = {}
    for (const row of (emailRes.data ?? []) as { id: string; email: string }[]) {
      if (row.email) rawEmailMap[row.id] = row.email
    }
    // 조직도에 넣거나 부서장으로 세울 후보다 — 나간 사람은 고를 수 없어야 한다
    orgProfiles = await activeMembers(db, (profilesRes.data ?? []).map((p: { id: string; name: string; rank: string | null; position: string | null }) => ({
      ...p,
      email: rawEmailMap[p.id] ?? null,
    })))
  }

  return (
    <div>
      <PageHeader title="구성원 관리" description="사용자 계정·조직도·직급 직책 통합 관리" />

      <SegmentedTabs
        ariaLabel="구성원 관리 분류"
        tabs={TABS.map((t) => ({
          id: t.key,
          label: t.label,
          href: `/admin/members?tab=${t.key}`,
          // 0명이면 배지를 안 그린다(배지 규칙 2) — 0 을 다른 숫자로 채우지도 않는다
          ...(t.key === 'resigned' && resignedProfiles.length > 0
            ? { badge: resignedProfiles.length, badgeTitle: `${RESIGNED_TAB.badgeMeaning} ${resignedProfiles.length}명` }
            : {}),
        }))}
        activeId={tab}
      />

      {/* 사용자 관리 탭 */}
      {tab === 'users' && (
        <>
          <div className="card" style={{ padding: 'var(--space-5) var(--space-6)', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '1rem' }}>
              <UserPlus size={16} color="var(--brand)" />
              <h2 className="tape-title" style={{ margin: 0 }}>새 구성원 초대</h2>
            </div>
            <InviteForm />
          </div>
          <div className="card card-flush">
            <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: 'var(--border-w-2) solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Users size={16} color="var(--brand)" />
              <h2 className="tape-title" style={{ margin: 0 }}>재직 구성원</h2>
              <span className="badge badge-slate">{activeProfiles.length}명</span>
            </div>
            <UserTable profiles={activeProfiles} emailMap={emailMap} currentUserId={user.id} ranks={ranks} positions={positions} employment={employment} mode="active" />
          </div>
        </>
      )}

      {/* 퇴사자 탭 — 재직 목록에서 뺀 사람들이 여기 모인다 */}
      {tab === 'resigned' && (
        <div className="card card-flush">
          <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: 'var(--border-w-2) solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <UserMinus size={16} color="var(--brand)" />
            <h2 className="tape-title" style={{ margin: 0 }}>{RESIGNED_TAB.label}</h2>
            {resignedProfiles.length > 0 && <span className="badge badge-slate">{resignedProfiles.length}명</span>}
          </div>
          <UserTable profiles={resignedProfiles} emailMap={emailMap} currentUserId={user.id} ranks={ranks} positions={positions} employment={employment} mode="resigned" />
        </div>
      )}

      {/* 조직도 관리 탭 */}
      {tab === 'org' && (
        <>
          <CompanyForm
            defaultName={orgCompany?.name ?? '회사명'}
            defaultDescription={orgCompany?.description ?? ''}
          />
          <OrgTree nodes={orgNodes} allProfiles={orgProfiles} />
        </>
      )}

      {/* 직급·직책 탭 */}
      {tab === 'ranks' && (
        <RankPositionManager ranks={ranks} positions={positions} />
      )}
    </div>
  )
}
