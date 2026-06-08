import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getWeekStart, toDateString } from '@/lib/utils'
import { addDays } from 'date-fns'
import RoutineGrid from './RoutineGrid'
import type { Profile } from '@/types/database'
import { DEFAULT_ROUTINES } from '@/lib/routine-defaults'
import type { RoutineItemParsed } from '@/lib/routine-defaults'

type RoutineItemRaw = string | { name: string; freq?: 'daily' | 'weekly' }

interface RoutineTemplate {
  name: string
  items?: RoutineItemRaw[]
  role?: string
  split?: string
  schedule?: Record<string, string[]>
}

function parseItems(items: RoutineItemRaw[]): RoutineItemParsed[] {
  return items.map((item) =>
    typeof item === 'string'
      ? { name: item, freq: 'weekly' as const }
      : { name: item.name, freq: item.freq ?? 'weekly' }
  )
}

export default async function RoutinePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const adminClient = createAdminClient()

  // 현재 유저 프로필 (name 필요)
  const { data: profile } = await adminClient
    .from('profiles')
    .select('name, must_change_password')
    .eq('id', user.id)
    .single() as unknown as { data: Pick<Profile, 'name' | 'must_change_password'> | null; error: unknown }

  const weekStart = getWeekStart()
  const weekStartStr = toDateString(weekStart)

  // 이번 주 7일 날짜 배열 (월~일)
  const weekDates = Array.from({ length: 7 }, (_, i) =>
    toDateString(addDays(weekStart, i))
  )

  const todayStr = toDateString(new Date())

  // org_content에서 routine_templates 로드
  const { data: rtRow } = await adminClient
    .from('org_content')
    .select('value')
    .eq('key', 'routine_templates')
    .single() as unknown as { data: { value: RoutineTemplate[] } | null; error: unknown }

  const templates = Array.isArray(rtRow?.value) ? (rtRow.value as RoutineTemplate[]) : []

  // 현재 유저의 이름으로 해당 멤버 루틴 템플릿 찾기
  const myTemplate = profile?.name
    ? templates.find((t) => t.name === profile.name)
    : null

  const routineItems: RoutineItemParsed[] =
    myTemplate?.items && myTemplate.items.length > 0
      ? parseItems(myTemplate.items)
      : DEFAULT_ROUTINES

  // 이름이 설정되지 않은 경우 안내
  const hasName = !!profile?.name && myTemplate != null

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
          루틴 체크
        </h1>
        <p style={{ color: 'var(--text-muted)', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          {hasName ? `${profile.name} · ` : ''}{weekLabel} ({weekStartStr} ~ {weekDates[6]})
        </p>
      </div>

      {!hasName && (
        <div style={{
          padding: '1rem 1.25rem',
          borderRadius: 'var(--radius)',
          marginBottom: '1.5rem',
          backgroundColor: 'var(--warning-bg)',
          border: 'var(--hairline) solid var(--warning-border)',
          color: 'var(--warning)',
          fontSize: '0.875rem',
        }}>
          프로필 이름이 조직도와 연결되지 않았습니다. 이름을 설정하면 개인 루틴이 표시됩니다.
        </div>
      )}

      <RoutineGrid
        weekDates={weekDates}
        weekStart={weekStartStr}
        initialChecks={routineChecks ?? []}
        todayStr={todayStr}
        routineItems={routineItems}
      />
    </div>
  )
}
