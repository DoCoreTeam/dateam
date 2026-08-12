import { redirect } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import { createClient } from '@/lib/supabase/server'
import { Tag, Plus } from 'lucide-react'
import TierForm from './TierForm'
import TierTable, { type PartnerTierRow } from './TierTable'

export default async function PartnerTiersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: tiers } = await supabase
    .from('partner_tiers')
    .select('*')
    .order('discount_rate', { ascending: false }) as unknown as { data: PartnerTierRow[] | null }

  const rows = tiers ?? []

  return (
    <div>
      <PageHeader title="파트너 등급 관리" description="파트너 등급과 할인율을 설정합니다" />

      {/* 새 등급 추가 */}
      <div className="card" style={{ padding: 'var(--space-5) var(--space-6)', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '1rem' }}>
          <Plus size={16} color="var(--brand)" />
          <h2 className="tape-title" style={{ margin: 0 }}>
            새 등급 추가
          </h2>
        </div>
        <TierForm mode="create" />
      </div>

      {/* 등급 목록 */}
      <div className="card" style={{ padding: 'var(--space-5) var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
          <Tag size={16} color="var(--brand)" />
          <h2 className="tape-title" style={{ margin: 0 }}>등급 목록</h2>
          <span className="badge badge-slate">{rows.length}개</span>
        </div>

        <TierTable tiers={rows} />
      </div>
    </div>
  )
}
