import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
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
    <div className="page-inner">
      <OrgPublicTree nodes={nodes} />
    </div>
  )
}
