import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWeekStart, toDateString } from '@/lib/utils'
import { subWeeks } from 'date-fns'
import { CheckSquare } from 'lucide-react'
import type { Profile, RoutineCheck } from '@/types/database'

const ROUTINES = ['Morning Standup', '리포트 확인', '이슈 로그', '업무 마감 체크']

interface PageProps {
  searchParams: Promise<{ week?: string }>
}

export default async function AdminRoutinePage({ searchParams }: PageProps) {
  const supabase = await createClient()
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

  // 전체 팀원
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, name')
    .is('deleted_at', null)
    .order('name') as unknown as { data: Pick<Profile, 'id' | 'name'>[] | null; error: unknown }

  // 선택 주의 루틴 체크 데이터
  const { data: checks } = await supabase
    .from('routine_checks')
    .select('user_id, routine_name, is_completed')
    .eq('week_start', selectedWeek) as unknown as { data: Pick<RoutineCheck, 'user_id' | 'routine_name' | 'is_completed'>[] | null; error: unknown }

  // 팀원별 × 루틴별 달성률 계산
  const checkMap: Record<string, Record<string, number>> = {}
  const checkTotal: Record<string, Record<string, number>> = {}

  ;(checks ?? []).forEach((c) => {
    if (!checkMap[c.user_id]) checkMap[c.user_id] = {}
    if (!checkTotal[c.user_id]) checkTotal[c.user_id] = {}
    if (!checkMap[c.user_id][c.routine_name]) checkMap[c.user_id][c.routine_name] = 0
    if (!checkTotal[c.user_id][c.routine_name]) checkTotal[c.user_id][c.routine_name] = 0

    checkTotal[c.user_id][c.routine_name] += 1
    if (c.is_completed) checkMap[c.user_id][c.routine_name] += 1
  })

  // 전체 달성률
  const allCompleted = (checks ?? []).filter((c) => c.is_completed).length
  const allTotal = (profiles?.length ?? 0) * ROUTINES.length * 7
  const overallRate = allTotal > 0 ? Math.round((allCompleted / allTotal) * 100) : 0

  return (
    <div style={{ maxWidth: '900px' }}>
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
          루틴 달성 현황
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          팀 전체 루틴 달성률을 주차별로 확인합니다
        </p>
      </div>

      {/* 필터 + 전체 달성률 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: '1rem',
          marginBottom: '1.5rem',
          alignItems: 'stretch',
        }}
      >
        <div className="card" style={{ padding: '1.25rem 1.5rem' }}>
          <form style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
            <div>
              <label htmlFor="week" className="label">주차 선택</label>
              <select
                id="week"
                name="week"
                defaultValue={selectedWeek}
                className="input-field"
                style={{ width: '220px', cursor: 'pointer' }}
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
          <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: 0, fontWeight: 500 }}>전체 달성률</p>
          <p
            style={{
              fontSize: '2rem',
              fontWeight: 700,
              color: overallRate >= 70 ? '#059669' : overallRate >= 40 ? '#d97706' : '#dc2626',
              letterSpacing: '-0.04em',
              margin: '0.25rem 0 0',
              lineHeight: 1.1,
            }}
          >
            {overallRate}%
          </p>
        </div>
      </div>

      {/* 달성률 테이블 */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <CheckSquare size={16} color="#6366f1" />
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>
            팀원별 루틴 달성률
          </h2>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="table-base" style={{ minWidth: '600px' }}>
            <thead>
              <tr>
                <th>팀원</th>
                {ROUTINES.map((r) => (
                  <th key={r} style={{ textAlign: 'center' }}>{r}</th>
                ))}
                <th style={{ textAlign: 'center' }}>평균</th>
              </tr>
            </thead>
            <tbody>
              {(profiles ?? []).map((profile) => {
                const userChecks = checkMap[profile.id] ?? {}
                const userTotal = checkTotal[profile.id] ?? {}

                const routineRates = ROUTINES.map((r) => {
                  const completed = userChecks[r] ?? 0
                  const total = 7
                  return Math.round((completed / total) * 100)
                })

                const avgRate = Math.round(routineRates.reduce((a, b) => a + b, 0) / ROUTINES.length)

                return (
                  <tr key={profile.id}>
                    <td>
                      <span style={{ fontWeight: 500, color: '#374151' }}>{profile.name}</span>
                    </td>
                    {routineRates.map((rate, i) => (
                      <td key={i} style={{ textAlign: 'center' }}>
                        <span
                          className="badge"
                          style={{
                            backgroundColor:
                              rate >= 80 ? '#ecfdf5' : rate >= 50 ? '#fffbeb' : '#fef2f2',
                            color:
                              rate >= 80 ? '#065f46' : rate >= 50 ? '#92400e' : '#991b1b',
                          }}
                        >
                          {rate}%
                        </span>
                      </td>
                    ))}
                    <td style={{ textAlign: 'center' }}>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: '0.9375rem',
                          color: avgRate >= 70 ? '#059669' : avgRate >= 40 ? '#d97706' : '#dc2626',
                        }}
                      >
                        {avgRate}%
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
