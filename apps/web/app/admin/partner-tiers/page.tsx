import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Tag, Plus } from 'lucide-react'
import TierForm from './TierForm'
import TierRow from './TierRow'

interface PartnerTier {
  id: string
  name: string
  discount_rate: number
  description: string | null
  created_at: string
}

export default async function PartnerTiersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: tiers } = await supabase
    .from('partner_tiers')
    .select('*')
    .order('discount_rate', { ascending: false }) as unknown as { data: PartnerTier[] | null }

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>
          파트너 등급 관리
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          파트너 등급과 할인율을 설정합니다
        </p>
      </div>

      {/* 새 등급 추가 */}
      <div className="card" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <Plus size={16} color="var(--brand)" />
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>
            새 등급 추가
          </h2>
        </div>
        <TierForm mode="create" />
      </div>

      {/* 등급 목록 */}
      <div className="card">
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '2px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Tag size={16} color="var(--brand)" />
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>등급 목록</h2>
          <span className="badge badge-slate">{tiers?.length ?? 0}개</span>
        </div>

        {(!tiers || tiers.length === 0) ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.875rem' }}>
            등록된 등급이 없습니다. 새 등급을 추가해주세요.
          </div>
        ) : (
          <table className="table-base table-card">
            <thead>
              <tr>
                <th>등급명</th>
                <th>할인율</th>
                <th>설명</th>
                <th>생성일</th>
                <th style={{ width: '140px' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => (
                <TierRow
                  key={tier.id}
                  id={tier.id}
                  name={tier.name}
                  discountRate={tier.discount_rate}
                  description={tier.description}
                  createdAt={tier.created_at}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
