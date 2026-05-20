import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { toDateString } from '@/lib/utils'
import { insertKpi } from './actions'
import KpiRow from './KpiRow'
import { TrendingUp, Plus } from 'lucide-react'
import type { KpiEntry } from '@/types/database'

interface KpiPageProps {
  searchParams: Promise<{ error?: string }>
}

export default async function KpiPage({ searchParams }: KpiPageProps) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { error } = await searchParams

  const { data: kpiEntries } = await supabase
    .from('kpi_entries')
    .select('*')
    .eq('user_id', user.id)
    .order('period_end', { ascending: false }) as unknown as { data: KpiEntry[] | null; error: unknown }

  const today = toDateString(new Date())

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1
          style={{
            fontSize: '1.5rem',
            fontWeight: 700,
            color: '#0f172a',
            letterSpacing: '-0.03em',
            margin: 0,
          }}
        >
          KPI 관리
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          성과 지표를 기록하고 추적합니다
        </p>
      </div>

      {/* 입력 폼 */}
      <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <Plus size={16} color="#6366f1" />
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>
            KPI 항목 추가
          </h2>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              padding: '0.75rem 1rem',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '0.625rem',
              marginBottom: '1rem',
              fontSize: '0.8125rem',
              color: '#b91c1c',
            }}
          >
            {decodeURIComponent(error)}
          </div>
        )}

        <form action={insertKpi}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 120px 100px 1fr 1fr',
              gap: '0.75rem',
              alignItems: 'end',
            }}
          >
            <div>
              <label htmlFor="metric_name" className="label">지표명</label>
              <input
                id="metric_name"
                name="metric_name"
                type="text"
                required
                placeholder="예: 신규 계약 건수"
                className="input-field"
              />
            </div>

            <div>
              <label htmlFor="value" className="label">값</label>
              <input
                id="value"
                name="value"
                type="number"
                step="any"
                required
                placeholder="0"
                className="input-field"
              />
            </div>

            <div>
              <label htmlFor="unit" className="label">단위</label>
              <input
                id="unit"
                name="unit"
                type="text"
                placeholder="건, %, 원"
                className="input-field"
              />
            </div>

            <div>
              <label htmlFor="period_start" className="label">기간 시작</label>
              <input
                id="period_start"
                name="period_start"
                type="date"
                required
                defaultValue={today}
                className="input-field"
              />
            </div>

            <div>
              <label htmlFor="period_end" className="label">기간 종료</label>
              <input
                id="period_end"
                name="period_end"
                type="date"
                required
                defaultValue={today}
                className="input-field"
              />
            </div>
          </div>

          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="btn-primary">
              <Plus size={15} />
              추가
            </button>
          </div>
        </form>
      </div>

      {/* KPI 히스토리 */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <TrendingUp size={16} color="#6366f1" />
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>
            KPI 히스토리
          </h2>
          <span className="badge badge-slate" style={{ marginLeft: '0.25rem' }}>
            {kpiEntries?.length ?? 0}건
          </span>
        </div>

        {kpiEntries && kpiEntries.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="table-base" style={{ minWidth: '640px' }}>
              <thead>
                <tr>
                  <th>지표명</th>
                  <th>값</th>
                  <th>단위</th>
                  <th>기간 시작</th>
                  <th>기간 종료</th>
                  <th style={{ width: '90px' }}></th>
                </tr>
              </thead>
              <tbody>
                {kpiEntries.map((kpi) => (
                  <KpiRow key={kpi.id} entry={kpi} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#94a3b8' }}>
            <TrendingUp size={36} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
            <p style={{ margin: 0, fontSize: '0.875rem' }}>아직 등록된 KPI가 없습니다</p>
          </div>
        )}
      </div>
    </div>
  )
}
