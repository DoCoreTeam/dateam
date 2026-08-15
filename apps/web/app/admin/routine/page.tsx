import { redirect } from 'next/navigation'
import { createClient, createAdminClient, getRequestUser } from '@/lib/supabase/server'
import { getWeekStart, toDateString } from '@/lib/utils'
import { subWeeks } from 'date-fns'
import { CheckSquare } from 'lucide-react'
import type { Profile, RoutineCheck } from '@/types/database'
import { DEFAULT_ROUTINES as DEFAULT_ITEMS } from '@/lib/routine-defaults'
import type { RoutineItemParsed } from '@/lib/routine-defaults'
import PageHeader from '@/components/ui/PageHeader'
import RoutineTable, { type RoutineMemberRow } from './RoutineTable'

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
  const user = await getRequestUser()

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

  // 팀원별 달성률 — 표시 계층(RoutineTable)에 직렬화 가능한 값만 넘긴다
  let allCompleted = 0
  let allTotal = 0
  const memberRows: RoutineMemberRow[] = profiles.map((p) => {
    const template = templates.find((t) => t.name === p.name)
    const items: RoutineItemParsed[] = template?.items?.length ? parseItems(template.items) : DEFAULT_ITEMS
    const userChecks = checkMap[p.id] ?? {}

    let completed = 0
    let total = 0
    const itemStats = items.map((item) => {
      const max = item.freq === 'weekly' ? 1 : 7
      const count = Math.min(userChecks[item.name] ?? 0, max)
      total += max
      completed += count
      return { name: item.name, freq: item.freq, count, max, rate: Math.round((count / max) * 100) }
    })

    allTotal += total
    allCompleted += completed

    return {
      id: p.id,
      name: p.name ?? '',
      hasTemplate: Boolean(template),
      rate: total > 0 ? Math.round((completed / total) * 100) : 0,
      items: itemStats,
    }
  })
  const overallRate = allTotal > 0 ? Math.round((allCompleted / allTotal) * 100) : 0

  return (
    <div>
      <PageHeader title="루틴 달성 현황" description="팀원별 개인 루틴 달성률을 주차별로 확인합니다" />

      {/* 필터 + 전체 달성률 */}
      <div className="responsive-grid-2" style={{ marginBottom: '1.5rem', alignItems: 'stretch' }}>
        <div className="card" style={{ padding: 'var(--space-5) var(--space-6)' }}>
          <form style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label htmlFor="week" className="label">주차 선택</label>
              <select id="week" name="week" className="input-field"
                defaultValue={selectedWeek}
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

        <div className="card" style={{ padding: 'var(--space-5) var(--space-6)', textAlign: 'center', minWidth: '160px' }}>
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0, fontWeight: 500 }}>전체 달성률</p>
          <p
            style={{
              fontSize: 'var(--fs-3xl)',
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

      {/* 팀원별 루틴 달성 목록 */}
      <div className="card" style={{ padding: 'var(--space-5) var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
          <CheckSquare size={16} color="var(--brand)" />
          <h2 className="tape-title" style={{ margin: 0 }}>팀원별 루틴 달성률</h2>
        </div>

        <RoutineTable members={memberRows} />
      </div>
    </div>
  )
}
