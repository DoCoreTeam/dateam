import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { Users, UserPlus } from 'lucide-react'
import InviteForm from '../users/InviteForm'
import UserTable from '../users/UserTable'
import CompanyForm from '../org-chart/CompanyForm'
import OrgTree from '../org-chart/OrgTree'
import RankPositionManager from '../org-chart/RankPositionManager'
import type { OrgNode } from '../org-chart/OrgNodeCard'
import type { Profile } from '@/types/database'

export const metadata = { title: '구성원 관리 | 어드민' }

const TABS = [
  { key: 'users', label: '사용자 관리' },
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
  const { data: { user } } = await supabase.auth.getUser()
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
  let profiles: Profile[] = []
  let emailMap: Record<string, string> = {}
  let orgCompany: { name: string; description: string | null } | null = null
  let orgNodes: OrgNode[] = []
  let orgProfiles: { id: string; name: string; rank: string | null; position: string | null; email?: string | null }[] = []

  if (tab === 'users') {
    const [profilesRes, authUsersRes] = await Promise.all([
      db.from('profiles').select('*').is('deleted_at', null).order('created_at', { ascending: true }),
      adminClient.auth.admin.listUsers({ perPage: 1000 }),
    ])
    profiles = (profilesRes.data ?? []) as Profile[]
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
    orgProfiles = (profilesRes.data ?? []).map((p: { id: string; name: string; rank: string | null; position: string | null }) => ({
      ...p,
      email: rawEmailMap[p.id] ?? null,
    }))
  }

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>
          구성원 관리
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          사용자 계정·조직도·직급 직책 통합 관리
        </p>
      </div>

      {/* 탭 네비게이션 */}
      <div style={{ display: 'flex', borderBottom: '2px solid #e2e8f0', marginBottom: '1.5rem' }}>
        {TABS.map(t => (
          <a
            key={t.key}
            href={`/admin/members?tab=${t.key}`}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.625rem 1.25rem',
              fontSize: '0.875rem', fontWeight: tab === t.key ? 600 : 400,
              color: tab === t.key ? 'var(--brand-dark)' : '#64748b',
              borderBottom: tab === t.key ? '2px solid var(--brand-dark)' : '2px solid transparent',
              marginBottom: '-2px',
              textDecoration: 'none',
              transition: 'color 0.15s',
            }}
          >
            {t.label}
          </a>
        ))}
      </div>

      {/* 사용자 관리 탭 */}
      {tab === 'users' && (
        <>
          <div className="card" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <UserPlus size={16} color="var(--brand)" />
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>새 구성원 초대</h2>
            </div>
            <InviteForm />
          </div>
          <div className="card">
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Users size={16} color="var(--brand)" />
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>전체 구성원</h2>
              <span className="badge badge-slate">{profiles.length}명</span>
            </div>
            <UserTable profiles={profiles} emailMap={emailMap} currentUserId={user.id} ranks={ranks} positions={positions} />
          </div>
        </>
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
