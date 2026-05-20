import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { toDateString, getWeekStart } from '@/lib/utils'
import { BarChart2 } from 'lucide-react'
import type { Profile, KpiEntry } from '@/types/database'

interface PageProps {
  searchParams: Promise<{ period_start?: string; period_end?: string }>
}

interface WeeklyKpiTarget {
  label: string
  target: string
  unit?: string
}

type KpiEntryWithProfile = KpiEntry & { profiles: { name: string } }

function parseTargetNumber(target: string): number {
  return parseFloat(target) || 0
}

function rateColor(rate: number) {
  if (rate >= 100) return { color: '#16a34a', background: '#f0fdf4' }
  if (rate >= 50) return { color: '#d97706', background: '#fffbeb' }
  return { color: '#dc2626', background: '#fef2f2' }
}

export default async function AdminKpiPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { period_start, period_end } = await searchParams

  const defaultStart = toDateString(getWeekStart(new Date()))
  const today = toDateString(new Date())
  const selectedStart = period_start ?? defaultStart
  const selectedEnd = period_end ?? today

  const adminClient = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = adminClient as any

  const [profilesRes, kpiTargetsRes] = await Promise.allSettled([
    adminClient.from('profiles').select('id, name').is('deleted_at', null).order('name'),
    adminClient.from('org_content').select('value').eq('key', 'kpi_targets').single(),
  ])

  const profiles: Pick<Profile, 'id' | 'name'>[] =
    profilesRes.status === 'fulfilled'
      ? ((profilesRes.value.data as Pick<Profile, 'id' | 'name'>[] | null) ?? [])
      : []

  const kpiTargetsData = kpiTargetsRes.status === 'fulfilled'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (kpiTargetsRes.value as any).data
    : null
  const kpiTargets: WeeklyKpiTarget[] = Array.isArray(kpiTargetsData?.value)
    ? (kpiTargetsData.value as WeeklyKpiTarget[])
    : []

  let query = adm
    .from('kpi_entries')
    .select('*, profiles(name)')
    .order('period_end', { ascending: false })
  if (selectedStart) query = query.gte('period_end', selectedStart)
  if (selectedEnd) query = query.lte('period_end', selectedEnd)

  const kpiRes = await Promise.allSettled([query as Promise<{ data: KpiEntryWithProfile[] | null }>])
  const allEntries: KpiEntryWithProfile[] =
    kpiRes[0].status === 'fulfilled' ? (kpiRes[0].value.data ?? []) : []

  const orgLabels = kpiTargets.map((t) => t.label)
  const extraLabels = Array.from(new Set(allEntries.map((e) => e.metric_name)))
    .filter((l) => !orgLabels.includes(l))
    .sort()
  const allMetrics = [
    ...orgLabels.filter((l) => allEntries.some((e) => e.metric_name === l)),
    ...extraLabels,
  ]

  const latestByUser: Record<string, Record<string, KpiEntryWithProfile>> = {}
  allEntries.forEach((entry) => {
    if (!latestByUser[entry.user_id]) latestByUser[entry.user_id] = {}
    if (!latestByUser[entry.user_id][entry.metric_name]) {
      latestByUser[entry.user_id][entry.metric_name] = entry
    }
  })

  const targetMap = new Map<string, { targetNum: number; unit: string; targetStr: string }>(
    kpiTargets.map((t) => [
      t.label,
      { targetNum: parseTargetNumber(t.target), unit: t.unit ?? '', targetStr: t.target },
    ])
  )

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>
          KPI 집계
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          팀원별 KPI 실적과 달성률을 확인합니다
        </p>
      </div>

      {/* 기간 필터 */}
      <div className="card" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
        <form style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
          <div>
            <label htmlFor="period_start" className="label">기간 시작</label>
            <input id="period_start" name="period_start" type="date" defaultValue={selectedStart} className="input-field" style={{ width: '160px' }} />
          </div>
          <div>
            <label htmlFor="period_end" className="label">기간 종료</label>
            <input id="period_end" name="period_end" type="date" defaultValue={selectedEnd} className="input-field" style={{ width: '160px' }} />
          </div>
          <button type="submit" className="btn-primary">조회</button>
        </form>
      </div>

      {/* 팀원별 KPI 달성률 */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: '1.5rem' }}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <BarChart2 size={16} color="#6366f1" />
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>팀원별 KPI 달성률</h2>
          <span style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>{selectedStart} ~ {selectedEnd}</span>
        </div>

        {allMetrics.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="table-base" style={{ minWidth: '600px' }}>
              <thead>
                <tr>
                  <th>팀원</th>
                  {allMetrics.map((m) => {
                    const t = targetMap.get(m)
                    return (
                      <th key={m} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {m}
                        {t && (
                          <span style={{ display: 'block', fontSize: '0.7rem', fontWeight: 400, color: '#94a3b8', marginTop: '0.1rem' }}>
                            목표 {t.targetStr}
                          </span>
                        )}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => {
                  const userMetrics = latestByUser[profile.id] ?? {}
                  return (
                    <tr key={profile.id}>
                      <td><span style={{ fontWeight: 500, color: '#374151' }}>{profile.name}</span></td>
                      {allMetrics.map((metric) => {
                        const entry = userMetrics[metric]
                        const t = targetMap.get(metric)
                        const actual = entry?.value ?? null
                        const rate =
                          actual !== null && t && t.targetNum > 0
                            ? Math.round((actual / t.targetNum) * 100)
                            : null

                        return (
                          <td key={metric} style={{ textAlign: 'right' }}>
                            {entry ? (
                              <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
                                <span>
                                  <strong style={{ color: '#0f172a' }}>{entry.value.toLocaleString()}</strong>
                                  {entry.unit && (
                                    <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginLeft: '0.2rem' }}>{entry.unit}</span>
                                  )}
                                </span>
                                {rate !== null && (
                                  <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: '9999px', ...rateColor(rate) }}>
                                    {rate}%
                                  </span>
                                )}
                              </div>
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
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0' }}>
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>전체 KPI 로그</h2>
        </div>
        <table className="table-base">
          <thead>
            <tr>
              <th>팀원</th>
              <th>KPI 항목</th>
              <th style={{ textAlign: 'right' }}>실적</th>
              <th>달성률</th>
              <th>기간</th>
            </tr>
          </thead>
          <tbody>
            {allEntries.map((entry) => {
              const t = targetMap.get(entry.metric_name)
              const rate = t && t.targetNum > 0 ? Math.round((entry.value / t.targetNum) * 100) : null
              return (
                <tr key={entry.id}>
                  <td><span style={{ fontWeight: 500 }}>{entry.profiles?.name ?? '-'}</span></td>
                  <td><span style={{ color: '#374151' }}>{entry.metric_name}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    <strong>{entry.value.toLocaleString()}</strong>
                    {entry.unit && <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginLeft: '0.25rem' }}>{entry.unit}</span>}
                  </td>
                  <td>
                    {rate !== null ? (
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '9999px', ...rateColor(rate) }}>
                        {rate}%
                      </span>
                    ) : (
                      <span style={{ color: '#cbd5e1', fontSize: '0.8125rem' }}>-</span>
                    )}
                  </td>
                  <td>
                    <span style={{ fontSize: '0.8125rem', color: '#64748b' }}>{entry.period_start} ~ {entry.period_end}</span>
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
