import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWeekStart, toDateString } from '@/lib/utils'
import { addDays } from 'date-fns'
import RoutineGrid from './RoutineGrid'

export default async function RoutinePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const weekStart = getWeekStart()
  const weekStartStr = toDateString(weekStart)

  // 이번 주 7일 날짜 배열 (월~일)
  const weekDates = Array.from({ length: 7 }, (_, i) =>
    toDateString(addDays(weekStart, i))
  )

  const todayStr = toDateString(new Date())

  // 이번 주 루틴 체크 데이터
  const { data: routineChecks } = await supabase
    .from('routine_checks')
    .select('*')
    .eq('user_id', user.id)
    .eq('week_start', weekStartStr)

  const weekLabel = (() => {
    const d = weekStart
    const year = d.getFullYear()
    const oneJan = new Date(year, 0, 1)
    const weekNum = Math.ceil(
      ((d.getTime() - oneJan.getTime()) / 86400000 + oneJan.getDay() + 1) / 7
    )
    return `${year}년 ${weekNum}주차`
  })()

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
          루틴 체크
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          {weekLabel} ({weekStartStr} ~ {weekDates[6]})
        </p>
      </div>

      <RoutineGrid
        weekDates={weekDates}
        weekStart={weekStartStr}
        initialChecks={routineChecks ?? []}
        todayStr={todayStr}
      />
    </div>
  )
}
