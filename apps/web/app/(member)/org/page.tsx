import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import OrgPublicTree from './OrgPublicTreeClient'
import { getBranding } from '@/lib/branding'

export async function generateMetadata() {
  const { brandName } = await getBranding()
  return { title: `조직도 | ${brandName}` }
}

export default async function OrgPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adb = adminClient as any

  const [nodesRes, profilesRes, emailRes] = await Promise.all([
    db.from('org_nodes').select('id, type, parent_id, name, subtitle, display_order, head_user_id, user_id, color').order('display_order'),
    adb.from('profiles').select('id, name, rank, position').is('deleted_at', null),
    adb.rpc('get_user_emails'),
  ])

  const emailMap: Record<string, string> = {}
  for (const row of (emailRes.data ?? []) as { id: string; email: string }[]) {
    if (row.email) emailMap[row.id] = row.email
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
