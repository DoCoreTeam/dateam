import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Building2, Users, ChevronRight } from 'lucide-react'

export const metadata = { title: '조직도 | AX사업본부' }

interface Member {
  id: string
  name: string | null
  email: string | null
}

interface Department {
  id: string
  name: string
  description: string | null
  parent_id: string | null
  display_order: number
  members: Member[]
}

function DeptTreeNode({ dept, allDepts, depth }: { dept: Department; allDepts: Department[]; depth: number }) {
  const children = allDepts
    .filter((d) => d.parent_id === dept.id)
    .sort((a, b) => a.display_order - b.display_order)

  return (
    <div style={{ marginLeft: depth > 0 ? depth * 20 : 0, marginTop: '0.5rem' }}>
      <div style={{
        padding: '0.625rem 0.875rem', borderRadius: '0.5rem',
        background: depth === 0 ? '#f8fafc' : '#ffffff',
        border: `1px solid ${depth === 0 ? '#c7d2fe' : '#e2e8f0'}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {depth > 0 && <ChevronRight size={14} color="#94a3b8" />}
          <span style={{ fontWeight: 700, fontSize: depth === 0 ? '1rem' : '0.9rem', color: '#1e293b' }}>
            {dept.name}
          </span>
          {dept.description && (
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{dept.description}</span>
          )}
          {dept.members.length > 0 && (
            <span style={{
              marginLeft: 'auto', fontSize: '0.75rem', fontWeight: 600,
              background: '#ede9fe', color: '#6d28d9', borderRadius: '999px',
              padding: '0.1rem 0.5rem', display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0,
            }}>
              <Users size={11} /> {dept.members.length}명
            </span>
          )}
        </div>

        {dept.members.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.5rem' }}>
            {dept.members.map((m) => (
              <span key={m.id} style={{
                display: 'inline-flex', alignItems: 'center',
                background: '#f1f5f9', color: '#475569', borderRadius: '999px',
                padding: '0.15rem 0.6rem', fontSize: '0.8125rem',
              }}>
                {m.name ?? m.email ?? '이름 없음'}
              </span>
            ))}
          </div>
        )}
      </div>

      {children.map((child) => (
        <DeptTreeNode key={child.id} dept={child} allDepts={allDepts} depth={depth + 1} />
      ))}
    </div>
  )
}

export default async function OrgPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const [companyRes, deptsRes, membersRes] = await Promise.all([
    db.from('org_company').select('name, description').eq('id', 1).single(),
    db.from('org_departments').select('id, name, description, parent_id, display_order').order('display_order'),
    db.from('org_department_members').select('department_id, user_id, profiles(id, name)'),
  ])

  const company = companyRes.data as { name: string; description: string | null } | null
  const rawDepts = (deptsRes.data ?? []) as {
    id: string; name: string; description: string | null; parent_id: string | null; display_order: number
  }[]
  const rawMembers = (membersRes.data ?? []) as {
    department_id: string; user_id: string; profiles: { id: string; name: string | null } | null
  }[]

  const membersByDept = rawMembers.reduce<Record<string, Member[]>>((acc, m) => {
    if (!m.profiles) return acc
    acc[m.department_id] = acc[m.department_id] ?? []
    acc[m.department_id].push({ id: m.user_id, name: m.profiles.name, email: null })
    return acc
  }, {})

  const departments: Department[] = rawDepts.map((d) => ({
    ...d,
    members: membersByDept[d.id] ?? [],
  }))

  const rootDepts = departments
    .filter((d) => d.parent_id === null)
    .sort((a, b) => a.display_order - b.display_order)

  return (
    <div className="page-inner" style={{ maxWidth: '720px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '1.25rem 1.5rem', borderRadius: '0.75rem',
        background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
        color: 'white', marginBottom: '1.5rem',
      }}>
        <Building2 size={28} />
        <div>
          <div style={{ fontSize: '1.375rem', fontWeight: 800 }}>{company?.name ?? '회사명'}</div>
          {company?.description && (
            <div style={{ fontSize: '0.875rem', opacity: 0.85, marginTop: '0.2rem' }}>{company.description}</div>
          )}
        </div>
      </div>

      {rootDepts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
          아직 등록된 부서가 없습니다.
        </div>
      ) : (
        rootDepts.map((dept) => (
          <DeptTreeNode key={dept.id} dept={dept} allDepts={departments} depth={0} />
        ))
      )}
    </div>
  )
}
