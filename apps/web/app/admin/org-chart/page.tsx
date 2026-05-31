import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import CompanyForm from './CompanyForm'
import OrgTree from './OrgTree'
import RankPositionManager from './RankPositionManager'
import type { OrgNode } from './OrgNodeCard'

export const metadata = { title: '조직도 관리 | 어드민' }

export default async function OrgChartAdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = adminClient as any

  const [companyRes, nodesRes, profilesRes, ranksRes, positionsRes] = await Promise.all([
    db.from('org_company').select('name, description').eq('id', 1).single(),
    db.from('org_nodes').select('id, type, parent_id, name, subtitle, display_order, head_user_id, user_id, color').order('display_order'),
    db.from('profiles').select('id, name, rank, position').is('deleted_at', null).order('name'),
    db.from('org_ranks').select('id, name, display_order').order('display_order'),
    db.from('org_positions').select('id, name, display_order').order('display_order'),
  ])

  const company = companyRes.data as { name: string; description: string | null } | null
  const nodes = (nodesRes.data ?? []) as OrgNode[]
  const allProfiles = (profilesRes.data ?? []) as { id: string; name: string; rank: string | null; position: string | null }[]
  const ranks = (ranksRes.data ?? []) as { id: number; name: string; display_order: number }[]
  const positions = (positionsRes.data ?? []) as { id: number; name: string; display_order: number }[]

  return (
    <div className="page-inner" style={{ maxWidth: '1200px' }}>
      <h2 style={{ margin: '0 0 1.5rem', fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>
        조직도 관리
      </h2>

      <CompanyForm
        defaultName={company?.name ?? '회사명'}
        defaultDescription={company?.description ?? ''}
      />

      <OrgTree nodes={nodes} allProfiles={allProfiles} />

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
