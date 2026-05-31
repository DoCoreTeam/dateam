import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import CompanyForm from './CompanyForm'
import OrgTree, { type Department, type Member } from './OrgTree'

export const metadata = { title: '조직도 관리 | 어드민' }

export default async function OrgChartAdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = adminClient as any

  const [companyRes, deptsRes, membersRes, profilesRes, authUsersRes] = await Promise.all([
    db.from('org_company').select('name, description').eq('id', 1).single(),
    db.from('org_departments').select('id, name, description, parent_id, display_order').order('display_order'),
    db.from('org_department_members').select('department_id, user_id, profiles(id, name)'),
    db.from('profiles').select('id, name').is('deleted_at', null).order('name'),
    adminClient.auth.admin.listUsers({ perPage: 1000 }),
  ])

  const emailMap = new Map(
    (authUsersRes.data?.users ?? []).map((u) => [u.id, u.email ?? ''])
  )

  const company = companyRes.data as { name: string; description: string | null } | null
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

      <OrgTree departments={departments} allProfiles={allProfiles} />
    </div>
  )
}
