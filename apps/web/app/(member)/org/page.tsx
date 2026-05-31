import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Building2, Crown, Users, User } from 'lucide-react'
import OrgPublicTree from './OrgPublicTree'

export const metadata = { title: '조직도 | AX사업본부' }

export default async function OrgPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const [companyRes, nodesRes] = await Promise.all([
    db.from('org_company').select('name, description').eq('id', 1).single(),
    db.from('org_nodes').select('id, type, parent_id, name, subtitle, display_order, head_user_id, user_id, color').order('display_order'),
  ])

  const company = companyRes.data as { name: string; description: string | null } | null
  const nodes = (nodesRes.data ?? []) as {
    id: string
    type: 'company' | 'role' | 'department' | 'person'
    parent_id: string | null
    name: string
    subtitle: string | null
    display_order: number
    head_user_id: string | null
    user_id: string | null
    color: string | null
  }[]

  return (
    <div className="page-inner" style={{ maxWidth: '1100px' }}>
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

      <OrgPublicTree nodes={nodes} />
    </div>
  )
}
