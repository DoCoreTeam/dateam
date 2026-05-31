import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import CompanyForm from './CompanyForm'
import OrgTree, { type Department, type Member } from './OrgTree'
import RankPositionManager from './RankPositionManager'

export const metadata = { title: '조직도 관리 | 어드민' }

export default async function OrgChartAdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = adminClient as any

  const [companyRes, deptsRes, membersRes, profilesRes, authUsersRes, ranksRes, positionsRes] = await Promise.all([
    db.from('org_company').select('name, description').eq('id', 1).single(),
    db.from('org_departments').select('id, name, description, parent_id, display_order').order('display_order'),
    db.from('org_department_members').select('department_id, user_id, profiles(id, name)'),
    db.from('profiles').select('id, name').is('deleted_at', null).order('name'),
    adminClient.auth.admin.listUsers({ perPage: 1000 }),
    db.from('org_ranks').select('id, name, display_order').order('display_order'),
    db.from('org_positions').select('id, name, display_order').order('display_order'),
  ])

  const emailMap = new Map(
    (authUsersRes.data?.users ?? []).map((u) => [u.id, u.email ?? ''])
  )

  const company = companyRes.data as { name: string; description: string | null } | null
  const ranks = (ranksRes.data ?? []) as { id: number; name: string; display_order: number }[]
  const positions = (positionsRes.data ?? []) as { id: number; name: string; display_order: number }[]
  const rawDepts = (deptsRes.data ?? []) as {
    id: string; name: string; description: string | null; parent_id: string | null; display_order: number
  }[]
  const rawMembers = (membersRes.data ?? []) as {
    department_id: string; user_id: string; profiles: { id: string; name: string | null } | null
  }[]
  const allProfiles: Member[] = (profilesRes.data ?? []).map(
    (p: { id: string; name: string | null }) => ({
      id: p.id,
      name: p.name,
      email: emailMap.get(p.id) ?? null,
    })
  )

  const membersByDept = rawMembers.reduce<Record<string, Member[]>>((acc, m) => {
    if (!m.profiles) return acc
    acc[m.department_id] = acc[m.department_id] ?? []
    acc[m.department_id].push({
      id: m.user_id,
      name: m.profiles.name,
      email: emailMap.get(m.user_id) ?? null,
    })
    return acc
  }, {})

  const departments: Department[] = rawDepts.map((d) => ({
    ...d,
    members: membersByDept[d.id] ?? [],
  }))

  return (
    <div className="page-inner" style={{ maxWidth: '860px' }}>
      <h2 style={{ margin: '0 0 1.5rem', fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>
        조직도 관리
      </h2>

      <CompanyForm
        defaultName={company?.name ?? '회사명'}
        defaultDescription={company?.description ?? ''}
      />

      <OrgTree departments={departments} allProfiles={allProfiles} companyName={company?.name} />

      <div style={{ marginTop: '2.5rem', borderTop: '1px solid #e2e8f0', paddingTop: '2rem' }}>
        <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>
          직급 · 직책 관리
        </h2>
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', color: '#64748b' }}>
          사용자 관리에서 선택 가능한 직급과 직책 목록을 설정합니다.
        </p>
        <RankPositionManager ranks={ranks} positions={positions} />
      </div>
    </div>
  )
}
