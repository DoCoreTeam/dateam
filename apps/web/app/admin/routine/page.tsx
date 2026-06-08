import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getWeekStart, toDateString } from '@/lib/utils'
import { subWeeks } from 'date-fns'
import { CheckSquare } from 'lucide-react'
import type { Profile, RoutineCheck } from '@/types/database'
import { DEFAULT_ROUTINES as DEFAULT_ITEMS } from '@/lib/routine-defaults'
import type { RoutineItemParsed } from '@/lib/routine-defaults'

type RoutineItemRaw = string | { name: string; freq?: 'daily' | 'weekly' }

interface RoutineTemplate {
  name: string
  items?: RoutineItemRaw[]
}

function parseItems(items: RoutineItemRaw[]): RoutineItemParsed[] {
  return items.map((item) =>
    typeof item === 'string'
      ? { name: item, freq: 'weekly' as const }
      : { name: item.name, freq: item.freq ?? 'weekly' }
  )
}

interface PageProps {
  searchParams: Promise<{ week?: string }>
}

export default async function AdminRoutinePage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const adminClient = createAdminClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { week } = await searchParams

  // 최근 4주 선택지
  const weekOptions = Array.from({ length: 4 }, (_, i) => {
    const d = getWeekStart(subWeeks(new Date(), i))
    return toDateString(d)
  })

  const selectedWeek = week ?? weekOptions[0]

  // 전체 팀원 + routine_templates 병렬 로드
  const [profilesResult, rtResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, name')
      .is('deleted_at', null)
      .order('name') as unknown as Promise<{ data: Pick<Profile, 'id' | 'name'>[] | null }>,
    adminClient
      .from('org_content')
      .select('value')
      .eq('key', 'routine_templates')
      .single() as unknown as Promise<{ data: { value: RoutineTemplate[] } | null }>,
  ])

  const profiles = profilesResult.data ?? []
  const templates: RoutineTemplate[] = Array.isArray(rtResult.data?.value) ? (rtResult.data!.value as RoutineTemplate[]) : []

  // 선택 주의 루틴 체크 데이터
  const { data: checks } = await supabase
    .from('routine_checks')
    .select('user_id, routine_name, is_completed')
    .eq('week_start', selectedWeek) as unknown as { data: Pick<RoutineCheck, 'user_id' | 'routine_name' | 'is_completed'>[] | null; error: unknown }

  // 팀원별 체크 집계
  const checkMap: Record<string, Record<string, number>> = {}
  ;(checks ?? []).forEach((c) => {
    if (!checkMap[c.user_id]) checkMap[c.user_id] = {}
    if (!checkMap[c.user_id][c.routine_name]) checkMap[c.user_id][c.routine_name] = 0
    if (c.is_completed) checkMap[c.user_id][c.routine_name] += 1
  })

  // 전체 달성률 계산 (weekly=1, daily=7)
  let allCompleted = 0
  let allTotal = 0
  profiles.forEach((p) => {
    const template = templates.find((t) => t.name === p.name)
    const items: RoutineItemParsed[] = template?.items?.length ? parseItems(template.items) : DEFAULT_ITEMS
    const userChecks = checkMap[p.id] ?? {}
    items.forEach((item) => {
      const max = item.freq === 'weekly' ? 1 : 7
      allTotal += max
      allCompleted += Math.min(userChecks[item.name] ?? 0, max)
    })
  })
  const overallRate = allTotal > 0 ? Math.round((allCompleted / allTotal) * 100) : 0

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1
          style={{
            fontSize: '1.5rem',
            fontWeight: 700,
            color: 'var(--text)',
            letterSpacing: '-0.03em',
            margin: 0,
          }}
        >
          루틴 달성 현황
        </h1>
        <p style={{ color: 'var(--text-muted)', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          팀원별 개인 루틴 달성률을 주차별로 확인합니다
        </p>
      </div>

      {/* 필터 + 전체 달성률 */}
      <div className="responsive-grid-2" style={{ marginBottom: '1.5rem', alignItems: 'stretch' }}>
        <div className="card" style={{ padding: '1.25rem 1.5rem' }}>
          <form style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label htmlFor="week" className="label">주차 선택</label>
              <select
                id="week"
                name="week"
                defaultValue={selectedWeek}
                className="input-field"
                style={{ width: 'clamp(160px, 100%, 220px)', cursor: 'pointer' }}
              >
                {weekOptions.map((w) => (
                  <option key={w} value={w}>
                    {new Date(w).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })} 주
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn-primary">조회</button>
          </form>
        </div>

        <div className="card" style={{ padding: '1.25rem 1.5rem', textAlign: 'center', minWidth: '160px' }}>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: 0, fontWeight: 500 }}>전체 달성률</p>
          <p
            style={{
              fontSize: '2rem',
              fontWeight: 700,
              color: overallRate >= 70 ? 'var(--success)' : overallRate >= 40 ? 'var(--warning)' : 'var(--danger)',
              letterSpacing: '-0.04em',
              margin: '0.25rem 0 0',
              lineHeight: 1.1,
            }}
          >
            {overallRate}%
          </p>
        </div>
      </div>

      {/* 팀원별 루틴 달성 카드 */}
      <div className="card">
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '2px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <CheckSquare size={16} color="var(--brand)" />
          <h2 className="tape-title" style={{ margin: 0 }}>
            팀원별 루틴 달성률
          </h2>
        </div>

        <table className="table-base table-card">
          <thead>
            <tr>
              <th>팀원</th>
              <th>루틴 항목</th>
              <th style={{ textAlign: 'center', width: '120px' }}>달성률</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => {
              const template = templates.find((t) => t.name === profile.name)
              const items: RoutineItemParsed[] = template?.items?.length ? parseItems(template.items) : DEFAULT_ITEMS
              const userChecks = checkMap[profile.id] ?? {}

              let completed = 0
              let total = 0
              items.forEach((item) => {
                const max = item.freq === 'weekly' ? 1 : 7
                total += max
                completed += Math.min(userChecks[item.name] ?? 0, max)
              })
              const rate = total > 0 ? Math.round((completed / total) * 100) : 0

              return (
                <tr key={profile.id}>
                  <td className="card-header">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '0.5rem' }}>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text)' }}>{profile.name || '-'}</div>
                        {!template && profile.name && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--warning)', marginTop: '2px' }}>
                            조직도 미연결
                          </div>
                        )}
                      </div>
                      <span style={{ fontWeight: 700, fontSize: '1.125rem', color: rate >= 70 ? 'var(--success)' : rate >= 40 ? 'var(--warning)' : 'var(--danger)', flexShrink: 0 }}>
                        {rate}%
                      </span>
                    </div>
                  </td>
                  <td data-label="루틴">
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                      {items.map((item) => {
                        const max = item.freq === 'weekly' ? 1 : 7
                        const itemCount = Math.min(userChecks[item.name] ?? 0, max)
                        const itemRate = Math.round((itemCount / max) * 100)
                        return (
                          <span
                            key={item.name}
                            className="badge"
                            style={{
                              backgroundColor: itemRate >= 80 ? 'var(--success-bg)' : itemRate >= 40 ? 'var(--warning-bg)' : 'var(--color-bg)',
                              color: itemRate >= 80 ? 'var(--success)' : itemRate >= 40 ? 'var(--warning)' : 'var(--text-muted)',
                              fontSize: '0.6875rem',
                            }}
                            title={item.freq === 'weekly' ? `${itemCount}/1회` : `${itemCount}/7일`}
                          >
                            {item.name} {item.freq === 'weekly' ? (itemRate === 100 ? '✓' : '미완') : `${itemRate}%`}
                          </span>
                        )
                      })}
                    </div>
                  </td>
                  <td className="card-hide" style={{ textAlign: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: '1rem', color: rate >= 70 ? 'var(--success)' : rate >= 40 ? 'var(--warning)' : 'var(--danger)' }}>
                      {rate}%
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
