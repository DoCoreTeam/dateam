import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient, createAdminClient, getRequestUser } from '@/lib/supabase/server'
import { getCalendarDayLogs } from '../daily/actions'
import { getWeekStart, toDateString } from '@/lib/utils'
import type { WeeklyReport } from '@/types/database'
import CalendarBoard from '../calendar/CalendarBoard'
import HomeQuickEntry from './HomeQuickEntry'
import HomeDeptTaskWidget from './HomeDeptTaskWidget'
import { listHomeDeptTasks } from '../dept-tasks/actions'
import Link from 'next/link'
import { FileText, BarChart2, CheckSquare, Building2 } from 'lucide-react'
import FridaySpotlightOverlay from '@/components/ui/FridaySpotlightOverlay'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import AXDotLoader from '@/components/ui/AXDotLoader'
import UnreviewedMemoWidget from '@/components/ui/memo/UnreviewedMemoWidget'
import HomeDrawer from './HomeDrawer'
import { isMemberOfDivisionByName } from '@/lib/org-scope'

export default async function HomePage() {
  const supabase = await createClient()
  const user = await getRequestUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const now = new Date()
  const todayStr = now.toLocaleDateString('sv', { timeZone: 'Asia/Seoul' })
  const weekStart = getWeekStart()
  const weekStartStr = toDateString(weekStart)

  const [profileResult, todayLogs, reportsResult, deptTasks, unreadMemoResult] = await Promise.all([
    adminClient.from('profiles').select('name, role, position').eq('id', user.id).single(),
    getCalendarDayLogs(todayStr),
    supabase
      .from('weekly_reports')
      .select('week_start, category, created_at')
      .eq('user_id', user.id)
      .order('week_start', { ascending: false })
      .limit(3),
    listHomeDeptTasks({ today: todayStr }),
    // 확인 안 한 메모 건수. **서버가 센다** — 클라이언트가 세면 탭을 펼치기 전까지
    // 배지가 비어 있어, 접힌 탭이 "볼 것 없음"으로 읽힌다(그게 서랍의 유일한 위험이다).
    // 조건은 /api/daily/memos?status=unreviewed 와 같아야 한다(다르면 배지와 목록이 어긋난다).
    supabase.from('daily_logs').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).is('deleted_at', null)
      .eq('entry_type', 'note').in('memo_status', ['new']),
  ])

  const profile = profileResult.data as { name: string; role: string; position: string | null } | null
  const reports = reportsResult.data as Pick<WeeklyReport, 'week_start' | 'category' | 'created_at'>[] | null

  // KPI·루틴·본부운영 타일은 AX사업본부 '소속 person'에게만 노출(admin·관할 무관).
  // 대표이사는 완전 예외 — AX 소속/관할이어도 숨김.
  const isCeo = profile?.position === '대표이사'
  const showAxTiles = !isCeo && await isMemberOfDivisionByName(adminClient, user.id, 'AX사업본부')

  const displayName = profile?.name ?? user.user_metadata?.name ?? user.email ?? '팀원'
  const isFriday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(new Date()) === 'Fri'
  const hasThisWeekReport = (reports ?? []).some((r) => r.week_start === weekStartStr)

  /**
   * 서랍 탭에 붙는 숫자. **전부 서버에서 센다.**
   * 클라이언트가 세면 탭을 펼치기 전까지 배지가 비어, 접힌 탭이 "볼 것 없음"으로 읽힌다.
   */
  const deptOverdue = deptTasks.counts.overdue
  const unreadMemos = unreadMemoResult.count ?? 0
  // 오늘 업무는 **아직 안 끝난 것**만 센다(done 제외) — 「이미 한 것」을 세면
  // 다른 탭의 배지와 뜻이 반대가 된다.
  const todayOpen = todayLogs.filter((l) => l.entry_type === 'doing' || l.entry_type === 'planned').length
  const showGlow = isFriday && !hasThisWeekReport

  return (
    <div>
      <FridaySpotlightOverlay showGlow={showGlow} />

      {/*
        레이아웃 전략 (flex column):
        - 헤더 / 위젯 3종 횡배치(데스크탑 grid 3col) / 캘린더 전체폭
        - 모바일(<768px): 동일 DOM 순서로 세로 스택 — 헤더→오늘업무→메모→주간보고→캘린더
      */}
      <div className="home-layout">

        {/*
          헤더 — 공용 PageHeader(제목 타이포 SSOT). 바로가기 칩은 헤더 액션으로.
          **compact 밀도**: 인사말은 첫 화면에서 가장 안 눌리는 자리다. 예전엔 제목·날짜가
          두 줄로 84px 를 먹어 그리드 시작을 화면의 40.8% 까지 밀어냈다(실측 v0.7.617).
          오늘 날짜는 캘린더가 이미 강조해 보여 준다 — 제목 옆 한 줄로 붙인다.
        */}
        <div className="home-section-header">
          <PageHeader
            className="page-header--compact"
            title={`안녕하세요, ${displayName}님`}
            titleAfter={
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                {now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })}
              </span>
            }
            actions={showAxTiles ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {[
                  { href: '/kpi', label: 'KPI', icon: <BarChart2 size={12} />, color: 'var(--brand)', bg: 'var(--brand-soft)' },
                  { href: '/routine', label: '루틴', icon: <CheckSquare size={12} />, color: 'var(--info)', bg: 'var(--info-bg)' },
                  { href: '/operations', label: '본부 운영', icon: <Building2 size={12} />, color: 'var(--success)', bg: 'var(--success-bg)' },
                ].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      padding: '0.2rem 0.6rem',
                      borderRadius: 'var(--radius)',
                      background: item.bg,
                      color: item.color,
                      fontSize: 'var(--fs-xs)',
                      fontWeight: 600,
                      textDecoration: 'none',
                      border: 'var(--hairline) solid var(--border-light)',
                      lineHeight: 1.4,
                      minHeight: '32px',
                    }}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                ))}
              </div>
            ) : undefined}
          />
        </div>

        {/**
          * **캘린더가 메인이다.** 사용자 지시(2026-08-27):
          * *"지금 홈화면에 캘린더를 메인으로 두자는 거야 ... 캘린더에 날짜를 누르면
          *   할 수 있는 모든 펑션이 나오는거고, CRM에 접속은 뭔가를 세부 확인하고 할때"*.
          *
          * 예전엔 위젯 셋을 지나 맨 아래에 **읽기 전용 미니 달력**이 있었다 — 날짜를 눌러도
          * 아무 일이 없었고, 무언가를 시작하려면 메뉴를 찾아 들어가야 했다.
          * 지금은 `/calendar` 와 **같은 보드**다(부품 하나 · §재사용·단일구현).
          * 날짜를 누르면 그 날의 작업대가 열리고 거기서 미팅·일정·할 일을 바로 시작한다.
          */}
        <div className="home-section-calendar">
          <Suspense fallback={<AXDotLoader />}>
            <CalendarBoard basePath="/home" compact />
          </Suspense>
        </div>

        {/*
          오늘 서랍 — 캘린더 아래 **한 장**.

          사용자 지시(2026-08-27): *"높낮이가 안 맞고 체계가 명확하지 않은 케이스를 처음 봤어.
          탭이든 버튼이든 처리할 수 있는 건 그렇게 하고 … 합칠 수는 없는 거야?"*

          예전엔 카드 넷이 나란히 있었다. 넷은 서로를 모르는 부품이라 각자 높이를 정했고
          실측(v0.7.617 · 뷰포트 819px) 부서 609 · 오늘 283 · 메모 245 · 주간보고 206 —
          **최대/최소 2.96배**였다. 한 줄로 세워도 넷의 바닥이 제각각이라 화면이 어수선했다.

          **넷이 동시에 다 보일 필요가 없다.** 한 번에 하나만 보이면 높이가 하나로 정해지고,
          껍데기가 하나라 여백·빈 상태도 하나가 된다. 접힌 것은 **탭의 건수 배지**로 알린다 —
          지난 지시(*"일부만 보이게 해서 바로 누를 수 있게"*)가 여기서 완성된다.
          다만 이제는 눌러도 화면을 떠나지 않는다.
        */}
        <HomeDrawer
          tabs={[
            {
              id: 'dept',
              label: '부서 업무',
              // 기한 지난 것만 센다. 없으면 **배지도 없다** — 예전엔 0일 때 전체 건수로
              // 슬쩍 바뀌어서, 같은 자리의 숫자가 어떤 날은 「밀린 것」 어떤 날은 「전부」였다.
              badge: deptOverdue || undefined,
              badgeTitle: '기한이 지난 업무',
              alert: deptOverdue > 0,
              content: <HomeDeptTaskWidget initial={deptTasks} today={todayStr} />,
            },
            {
              id: 'today',
              label: '오늘 업무',
              badge: todayOpen || undefined,
              badgeTitle: '아직 끝나지 않은 오늘 업무',
              content: <HomeQuickEntry todayStr={todayStr} initialLogs={todayLogs} />,
            },
            {
              id: 'memo',
              label: '메모',
              badge: unreadMemos || undefined,
              badgeTitle: '아직 확인하지 않은 메모',
              // 주의 색을 쓰지 않는다 — 메모는 쌓이는 것이지 기한이 있는 게 아니다.
              // 배지 넷이 다 빨가면 아무것도 빨갛지 않은 것과 같다(실측: 셋이 동시에 빨갰다).
              content: <UnreviewedMemoWidget variant="compact" />,
            },
            {
              id: 'weekly',
              label: '주간보고',
              // 이번 주 것이 없으면 숫자 대신 상태를 적는다 — "0" 은 없다는 뜻으로 안 읽힌다
              badge: hasThisWeekReport ? undefined : '미작성',
              badgeTitle: '이번 주 주간보고를 아직 쓰지 않았습니다',
              alert: !hasThisWeekReport,
              content: (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <FileText size={15} color="var(--brand)" />
                      <h3 className="tape-title" style={{ margin: 0 }}>최근 주간보고</h3>
                    </div>
                    <Link href="/weekly-report" style={{ fontSize: 'var(--fs-xs)', color: 'var(--brand)', textDecoration: 'none', fontWeight: 600 }}>
                      {hasThisWeekReport ? '전체 보기 →' : '이번 주 작성하기 →'}
                    </Link>
                  </div>
                  {reports && reports.length > 0 ? (
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {reports.map((r, i) => (
                        <li key={i} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '0.4rem 0.625rem', background: 'var(--color-bg)',
                          borderRadius: 'var(--radius)', border: 'var(--hairline) solid var(--surface-muted)',
                        }}>
                          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                            {new Date(r.week_start).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} 주
                          </span>
                          <span className="badge badge-indigo">{r.category}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState
                      title="아직 주간보고가 없어요"
                      description="이번 주 한 일을 정리해 두면 취합이 쉬워집니다"
                      action={{ label: '주간보고 작성', href: '/weekly-report' }}
                    />
                  )}
                </div>
              ),
            },
          ]}
        />

      </div>
    </div>
  )
}
