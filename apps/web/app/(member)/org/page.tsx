import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import OrgPublicTree from './OrgPublicTree'

export const metadata = { title: '조직도 | AX사업본부' }

export default async function OrgPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adb = adminClient as any

  const [nodesRes, profilesRes, authUsersRes] = await Promise.all([
    db.from('org_nodes').select('id, type, parent_id, name, subtitle, display_order, head_user_id, user_id, color').order('display_order'),
    adb.from('profiles').select('id, name, rank, position').is('deleted_at', null),
    adminClient.auth.admin.listUsers({ perPage: 1000 }),
  ])

  const emailMap: Record<string, string> = {}
  for (const u of authUsersRes.data?.users ?? []) {
    if (u.email) emailMap[u.id] = u.email
  }

  const profileMap: Record<string, { name: string; rank: string | null; position: string | null }> = {}
  for (const p of (profilesRes.data ?? []) as { id: string; name: string; rank: string | null; position: string | null }[]) {
    profileMap[p.id] = p
  }

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
      <OrgPublicTree nodes={nodes} emailMap={emailMap} profileMap={profileMap} />
    </div>
  )
}
