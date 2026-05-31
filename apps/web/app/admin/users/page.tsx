import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { Users, UserPlus } from 'lucide-react'
import InviteForm from './InviteForm'
import UserTable from './UserTable'
import type { Profile } from '@/types/database'

export default async function AdminUsersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = adminClient as any

  const [profilesRes, authUsersRes, ranksRes, positionsRes] = await Promise.all([
    db.from('profiles').select('*').is('deleted_at', null).order('created_at', { ascending: true }),
    adminClient.auth.admin.listUsers({ perPage: 1000 }),
    db.from('org_ranks').select('id, name, display_order').order('display_order'),
    db.from('org_positions').select('id, name, display_order').order('display_order'),
  ])

  const profiles = (profilesRes.data ?? []) as Profile[]
  const emailMap: Record<string, string> = Object.fromEntries(
    (authUsersRes.data?.users ?? []).map((u: { id: string; email?: string }) => [u.id, u.email ?? ''])
  )
  const ranks = (ranksRes.data ?? []) as { id: number; name: string; display_order: number }[]
  const positions = (positionsRes.data ?? []) as { id: number; name: string; display_order: number }[]

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>
          사용자 관리
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          팀원 계정 생성 및 역할 관리
        </p>
      </div>

      {/* 새 팀원 초대 */}
      <div className="card" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <UserPlus size={16} color="#6366f1" />
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>
            새 팀원 초대
          </h2>
        </div>
        <InviteForm />
      </div>

      {/* 사용자 목록 */}
      <div className="card">
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Users size={16} color="#6366f1" />
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>전체 팀원</h2>
          <span className="badge badge-slate">{profiles.length}명</span>
        </div>

        <UserTable
          profiles={profiles}
          emailMap={emailMap}
          currentUserId={user.id}
          ranks={ranks}
          positions={positions}
        />
      </div>
    </div>
  )
}
