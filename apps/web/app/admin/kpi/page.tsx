import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { toDateString } from '@/lib/utils'
import { BarChart2 } from 'lucide-react'
import type { Profile, KpiEntry } from '@/types/database'

interface PageProps {
  searchParams: Promise<{ period_start?: string; period_end?: string }>
}

export default async function AdminKpiPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { period_start, period_end } = await searchParams

  const today = toDateString(new Date())
  const defaultStart = (() => {
    const d = new Date()
    d.setDate(1)
    return toDateString(d)
  })()

  const selectedStart = period_start ?? defaultStart
  const selectedEnd = period_end ?? today

  const adminClient = createAdminClient()

  // 전체 팀원 (RLS 우회 — 어드민 전용 페이지)
  const { data: profiles } = await adminClient
    .from('profiles')
    .select('id, name')
    .is('deleted_at', null)
    .order('name') as unknown as { data: Pick<Profile, 'id' | 'name'>[] | null; error: unknown }

  // 기간 필터 KPI (RLS 우회 — 어드민 전용 페이지)
  type KpiEntryWithProfile = KpiEntry & { profiles: { name: string } }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (adminClient as any)
    .from('kpi_entries')
    .select('*, profiles(name)')
    .order('period_end', { ascending: false })

  if (selectedStart) query = query.gte('period_end', selectedStart)
  if (selectedEnd) query = query.lte('period_end', selectedEnd)

  const { data: kpiEntries } = await query as { data: KpiEntryWithProfile[] | null; error: unknown }

  // 팀원별 최신 KPI 그룹화
  const latestByUser: Record<string, Record<string, KpiEntryWithProfile>> = {}

  ;(kpiEntries ?? []).forEach((entry) => {
    if (!latestByUser[entry.user_id]) latestByUser[entry.user_id] = {}
    if (!latestByUser[entry.user_id][entry.metric_name]) {
      latestByUser[entry.user_id][entry.metric_name] = entry
    }
  })

  // 전체 고유 KPI 이름
  const allMetrics = Array.from(
    new Set((kpiEntries ?? []).map((e) => e.metric_name))
  ).sort()

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
          KPI 집계
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          팀원별 KPI 수치를 집계합니다
        </p>
      </div>

      {/* 기간 필터 */}
      <div className="card" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
        <form style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
          <div>
            <label htmlFor="period_start" className="label">기간 시작</label>
            <input
              id="period_start"
              name="period_start"
              type="date"
              defaultValue={selectedStart}
              className="input-field"
              style={{ width: '160px' }}
            />
          </div>
          <div>
            <label htmlFor="period_end" className="label">기간 종료</label>
            <input
              id="period_end"
              name="period_end"
              type="date"
              defaultValue={selectedEnd}
              className="input-field"
              style={{ width: '160px' }}
            />
          </div>
          <button type="submit" className="btn-primary">조회</button>
        </form>
      </div>

      {/* 팀원별 최신 KPI 테이블 */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: '1.5rem' }}>
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <BarChart2 size={16} color="#6366f1" />
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>
            팀원별 최신 KPI
          </h2>
          <span style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>
            {selectedStart} ~ {selectedEnd}
          </span>
        </div>

        {allMetrics.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="table-base" style={{ minWidth: '600px' }}>
              <thead>
                <tr>
                  <th>팀원</th>
                  {allMetrics.map((m) => (
                    <th key={m} style={{ textAlign: 'right' }}>{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(profiles ?? []).map((profile) => {
                  const userMetrics = latestByUser[profile.id] ?? {}
                  return (
                    <tr key={profile.id}>
                      <td>
                        <span style={{ fontWeight: 500, color: '#374151' }}>{profile.name}</span>
                      </td>
                      {allMetrics.map((metric) => {
                        const entry = userMetrics[metric]
                        return (
                          <td key={metric} style={{ textAlign: 'right' }}>
                            {entry ? (
                              <span>
                                <strong style={{ color: '#0f172a' }}>
                                  {entry.value.toLocaleString()}
                                </strong>
                                {entry.unit && (
                                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginLeft: '0.25rem' }}>
                                    {entry.unit}
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span style={{ color: '#cbd5e1', fontSize: '0.8125rem' }}>-</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#94a3b8', fontSize: '0.875rem' }}>
            <BarChart2 size={36} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
            <p style={{ margin: 0 }}>해당 기간에 입력된 KPI 데이터가 없습니다</p>
          </div>
        )}
      </div>

      {/* 전체 KPI 로그 */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid #e2e8f0',
          }}
        >
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>
            전체 KPI 로그
          </h2>
        </div>

        <table className="table-base">
          <thead>
            <tr>
              <th>팀원</th>
              <th>지표명</th>
              <th style={{ textAlign: 'right' }}>값</th>
              <th>단위</th>
              <th>기간</th>
            </tr>
          </thead>
          <tbody>
            {(kpiEntries ?? []).map((entry) => {
              return (
                <tr key={entry.id}>
                  <td><span style={{ fontWeight: 500 }}>{entry.profiles?.name ?? '-'}</span></td>
                  <td><span style={{ color: '#374151' }}>{entry.metric_name}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    <strong>{entry.value.toLocaleString()}</strong>
                  </td>
                  <td><span style={{ color: '#64748b', fontSize: '0.8125rem' }}>{entry.unit || '-'}</span></td>
                  <td>
                    <span style={{ fontSize: '0.8125rem', color: '#64748b' }}>
                      {entry.period_start} ~ {entry.period_end}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
