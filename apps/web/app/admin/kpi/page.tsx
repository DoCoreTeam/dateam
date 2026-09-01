import { redirect } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import DateField from '@/components/ui/DateField'
import { createClient, createAdminClient, getRequestUser } from '@/lib/supabase/server'
import { toDateString, getWeekStart } from '@/lib/utils'
import { BarChart2 } from 'lucide-react'
import type { Profile, KpiEntry } from '@/types/database'
import { rateColor } from './rate-color'
import KpiLogTable, { type KpiLogRow } from './KpiLogTable'

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

export default async function AdminKpiPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const user = await getRequestUser()
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

  // 목록 부품으로 넘길 직렬화 가능한 행(달성률까지 서버에서 산출)
  const logRows: KpiLogRow[] = allEntries.map((entry) => {
    const t = targetMap.get(entry.metric_name)
    return {
      id: entry.id,
      userName: entry.profiles?.name ?? '-',
      metricName: entry.metric_name,
      value: entry.value,
      unit: entry.unit ?? null,
      rate: t && t.targetNum > 0 ? Math.round((entry.value / t.targetNum) * 100) : null,
      periodStart: entry.period_start,
      periodEnd: entry.period_end,
    }
  })

  return (
    <div>
      <PageHeader title="KPI 집계" description="팀원별 KPI 실적과 달성률을 확인합니다" />

      {/* 기간 필터 */}
      <div className="card" style={{ padding: 'var(--space-5) var(--space-6)', marginBottom: '1.5rem' }}>
        <form style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label htmlFor="period_start" className="label">기간 시작</label>
            <DateField id="period_start" name="period_start" defaultValue={selectedStart} style={{ width: 'clamp(140px, 100%, 160px)' }} />
          </div>
          <div>
            <label htmlFor="period_end" className="label">기간 종료</label>
            <DateField id="period_end" name="period_end" defaultValue={selectedEnd} style={{ width: 'clamp(140px, 100%, 160px)' }} />
          </div>
          <button type="submit" className="btn-primary">조회</button>
        </form>
      </div>

      {/* 팀원별 KPI 달성률 — 사람×지표 교차표(목록이 아니라 피벗이라 표를 유지) */}
      <div className="card card-flush" style={{ marginBottom: '1.5rem' }}>
        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: 'var(--border-w-2) solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <BarChart2 size={16} color="var(--brand)" />
          <h2 className="tape-title" style={{ margin: 0 }}>팀원별 KPI 달성률</h2>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>{selectedStart} ~ {selectedEnd}</span>
        </div>

        {allMetrics.length > 0 ? (
          <div className="table-responsive">
            <table className="table-base table-card">
              <thead>
                <tr>
                  <th>팀원</th>
                  {allMetrics.map((m) => {
                    const t = targetMap.get(m)
                    return (
                      <th key={m} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {m}
                        {t && (
                          <span style={{ display: 'block', fontSize: 'var(--fs-2xs)', fontWeight: 400, color: 'var(--text-faint)', marginTop: '0.1rem' }}>
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
                      <td className="card-header"><span style={{ fontWeight: 500, color: 'var(--text)' }}>{profile.name}</span></td>
                      {allMetrics.map((metric) => {
                        const entry = userMetrics[metric]
                        const t = targetMap.get(metric)
                        const actual = entry?.value ?? null
                        const rate =
                          actual !== null && t && t.targetNum > 0
                            ? Math.round((actual / t.targetNum) * 100)
                            : null

                        return (
                          <td key={metric} data-label={metric} style={{ textAlign: 'right' }}>
                            {entry ? (
                              <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
                                <span>
                                  <strong style={{ color: 'var(--text)' }}>{entry.value.toLocaleString()}</strong>
                                  {entry.unit && (
                                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginLeft: '0.2rem' }}>{entry.unit}</span>
                                  )}
                                </span>
                                {rate !== null && (
                                  <span className="badge" style={{ ...rateColor(rate), fontSize: 'var(--fs-2xs)', fontWeight: 700 }}>
                                    {rate}%
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>-</span>
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
          <EmptyState
            icon={<BarChart2 size={36} />}
            title="해당 기간에 입력된 KPI가 없어요"
            description="기간을 넓혀 조회하거나, 조직 KPI 목표를 먼저 설정하세요"
            action={{ label: 'KPI 목표 설정', href: '/admin/content' }}
          />
        )}
      </div>

      {/* 전체 KPI 로그 */}
      <div className="card" style={{ padding: 'var(--space-5) var(--space-6)' }}>
        <h2 className="tape-title" style={{ margin: '0 0 var(--space-4)' }}>전체 KPI 로그</h2>
        <KpiLogTable entries={logRows} />
      </div>
    </div>
  )
}
