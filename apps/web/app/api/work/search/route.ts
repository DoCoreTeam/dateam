import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { htmlToPlain } from '@/lib/html-to-plain'
import type { DailyLog, WeeklyReport } from '@/types/database'

// 통합 검색 (설계 01-architecture ④). GET /api/work/search?q=&types=&limit=&cursor=
// 3 소스(개인 일일·부서업무·주간보고)를 병렬 조회 후 date DESC 통합 + 커서 페이지네이션.
//
// 스코프/권한(default-deny):
//  - daily personal : createClient(사용자) + user_id=me → RLS·소유 한정.
//  - dept_task      : createClient(사용자) + task_kind='dept_task'. daily_logs RLS가 부서 가시범위를
//                     1차 강제(listDeptTasks와 동일 패턴 — 별도 deptId 필터 불필요, RLS 신뢰).
//  - weekly         : createClient(사용자) + user_id=me. 팀 주간보고 가시성은 *본인 한정*(초기 정책).
//                     추후 계층 가시범위 확장은 weekly_report_hierarchy 정책과 함께 별도 반영.
// 타인 개인업무/타부서 비가시 업무는 RLS+소유필터로 노출 차단.

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const MAX_Q_LEN = 200
const TITLE_LEN = 80
const SNIPPET_RADIUS = 50

type ResultType = 'daily' | 'dept' | 'weekly'
const ALL_TYPES: ResultType[] = ['daily', 'dept', 'weekly']

interface SearchResult {
  type: ResultType
  id: string
  title: string
  snippet: string
  date: string
  href: string
}

/** ilike 패턴 메타문자(%, _, \) 이스케이프 — 와일드카드 오염/패턴 인젝션 방지 */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/** PostgREST or() 필터 값 이스케이프 — 값을 쌍따옴표로 감싸 콤마/괄호로 인한 OR DSL 파싱 깨짐 방지.
 *  값 내부 백슬래시/쌍따옴표는 이스케이프(PostgREST 따옴표 규칙). */
function orQuote(value: string): string {
  return `"${value.replace(/[\\"]/g, (ch) => `\\${ch}`)}"`
}

/** plain 텍스트에서 q 주변을 잘라 스니펫 생성 (없으면 앞부분) */
function makeSnippet(plain: string, qLower: string): string {
  const idx = plain.toLowerCase().indexOf(qLower)
  if (idx < 0) return plain.slice(0, TITLE_LEN)
  const start = Math.max(0, idx - SNIPPET_RADIUS)
  const end = Math.min(plain.length, idx + qLower.length + SNIPPET_RADIUS)
  return (start > 0 ? '…' : '') + plain.slice(start, end) + (end < plain.length ? '…' : '')
}

/** date+id 합성 커서 (date DESC 안정 정렬용). base64로 인코딩 */
function encodeCursor(date: string, id: string): string {
  return Buffer.from(`${date}|${id}`).toString('base64url')
}
function decodeCursor(cursor: string): { date: string; id: string } | null {
  try {
    const [date, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
    if (!date || !id) return null
    return { date, id }
  } catch {
    return null
  }
}

function parseTypes(raw: string | null): ResultType[] {
  if (!raw) return ALL_TYPES
  const set = new Set(raw.split(',').map((t) => t.trim()))
  const picked = ALL_TYPES.filter((t) => set.has(t))
  return picked.length > 0 ? picked : ALL_TYPES
}

export async function GET(req: NextRequest) {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  const userId = auth.user.id

  const sp = req.nextUrl.searchParams
  const qRaw = (sp.get('q') ?? '').trim()
  if (!qRaw) {
    return NextResponse.json(
      { results: [], nextCursor: null, hasMore: false },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }
  const q = qRaw.slice(0, MAX_Q_LEN)
  const qLower = q.toLowerCase()
  const pattern = `%${escapeLike(q)}%`

  const types = parseTypes(sp.get('types'))
  // floor 먼저 후 >0 체크 — limit=0.9 → floor=0 → 빈결과 silent 결함 방지(0이면 DEFAULT)
  const limitFloor = Math.floor(Number(sp.get('limit')))
  const limit = Number.isFinite(limitFloor) && limitFloor > 0 ? Math.min(limitFloor, MAX_LIMIT) : DEFAULT_LIMIT
  const cursor = sp.get('cursor') ? decodeCursor(sp.get('cursor') as string) : null
  // 소스별 DB fetch 상한 — keyset로 "커서보다 과거" 행을 새로 가져오므로 페이지 크기에 비례하면 충분.
  // limit+1로 hasMore 판정, 동일-date tiebreak(id) 보정 여유로 *2.
  const perSourceFetch = limit * 2 + 1

  try {
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    const tasks: Array<Promise<SearchResult[]>> = []

    // 1) 개인 일일업무 — 소유 + personal + content ilike (RLS·소유 한정)
    //    통합 정렬 키(log_date)와 동일 컬럼으로 DB order/keyset → 누락 위험 제거.
    if (types.includes('daily')) {
      let qb = db.from('daily_logs')
        .select('id,content,log_date,created_at')
        .eq('user_id', userId)
        .eq('task_kind', 'personal')
        .eq('is_onboarding', false)   // 온보딩 실습 행 제외(검색 결과 오염 방지)
        .ilike('content', pattern)
      // lte(=커서 포함)로 동일-date 행도 DB에서 가져온 뒤, app-side afterCursor가 id로 보정 제거.
      if (cursor) qb = qb.lte('log_date', cursor.date)
      tasks.push(
        qb.order('log_date', { ascending: false })
          .order('id', { ascending: false })
          .limit(perSourceFetch)
          .then(({ data }: { data: DailyLog[] | null }) =>
            (data ?? []).map((r): SearchResult => {
              const plain = (r.content ?? '').trim()
              return {
                type: 'daily',
                id: r.id,
                title: plain.slice(0, TITLE_LEN),
                snippet: makeSnippet(plain, qLower),
                date: r.log_date ?? r.created_at,
                href: r.log_date ? `/daily?date=${r.log_date}` : '/daily',
              }
            }),
          ),
      )
    }

    // 2) 부서업무 — task_kind='dept_task' + content ilike (RLS가 부서 가시범위 강제)
    //    통합 정렬 키(log_date)와 동일 컬럼으로 DB order/keyset.
    if (types.includes('dept')) {
      let qb = db.from('daily_logs')
        .select('id,content,log_date,created_at,department_id')
        .eq('task_kind', 'dept_task')
        .ilike('content', pattern)
      if (cursor) qb = qb.lte('log_date', cursor.date)
      tasks.push(
        qb.order('log_date', { ascending: false })
          .order('id', { ascending: false })
          .limit(perSourceFetch)
          .then(({ data }: { data: DailyLog[] | null }) =>
            (data ?? []).map((r): SearchResult => {
              const plain = (r.content ?? '').trim()
              return {
                type: 'dept',
                id: r.id,
                title: plain.slice(0, TITLE_LEN),
                snippet: makeSnippet(plain, qLower),
                date: r.log_date ?? r.created_at,
                href: `/dept-tasks?task=${r.id}`,
              }
            }),
          ),
      )
    }

    // 3) 주간보고 — 본인 + soft-delete 제외. 1차 DB ilike(HTML 포함)로 후보 좁히고
    //    BE에서 htmlToPlain 후 q 재확인(태그가 글자로 매칭되는 오탐 제거) + 스니펫 생성.
    if (types.includes('weekly')) {
      // or() 값은 쌍따옴표 래핑(orQuote) — q의 콤마/괄호로 인한 OR DSL 파싱 깨짐 방지.
      const qp = orQuote(pattern)
      let qb = db.from('weekly_reports')
        .select('id,category,performance,plan,issues,week_start,created_at')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .or(`performance.ilike.${qp},plan.ilike.${qp},issues.ilike.${qp},category.ilike.${qp}`)
      if (cursor) qb = qb.lte('week_start', cursor.date)
      tasks.push(
        qb.order('week_start', { ascending: false })
          .order('id', { ascending: false })
          .limit(perSourceFetch)
          .then(({ data }: { data: WeeklyReport[] | null }) =>
            (data ?? [])
              .map((r): SearchResult | null => {
                const fields = [r.category, r.performance, r.plan, r.issues]
                const plain = fields.map((f) => htmlToPlain(f)).filter(Boolean).join('\n').trim()
                // HTML→plain 후 q 미포함이면 오탐(태그/속성만 매칭) → 제외
                if (!plain.toLowerCase().includes(qLower)) return null
                return {
                  type: 'weekly',
                  id: r.id,
                  title: (r.category || plain.slice(0, TITLE_LEN)).slice(0, TITLE_LEN),
                  snippet: makeSnippet(plain, qLower),
                  date: r.week_start ?? r.created_at,
                  href: r.week_start ? `/weekly-report?week=${r.week_start}` : '/weekly-report',
                }
              })
              .filter((x): x is SearchResult => x !== null),
          ),
      )
    }

    const grouped = await Promise.all(tasks)
    const merged = grouped.flat()

    // date DESC, 동률은 id DESC(안정 정렬·커서 결정성)
    merged.sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1))

    // 커서 이후만 (date+id 기준)
    const afterCursor = cursor
      ? merged.filter((r) => r.date < cursor.date || (r.date === cursor.date && r.id < cursor.id))
      : merged

    const page = afterCursor.slice(0, limit + 1)
    const hasMore = page.length > limit
    const results = hasMore ? page.slice(0, limit) : page
    const last = results[results.length - 1]
    const nextCursor = hasMore && last ? encodeCursor(last.date, last.id) : null

    return NextResponse.json(
      { results, nextCursor, hasMore },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error: unknown) {
    console.error('[api/work/search]', error)
    return NextResponse.json({ error: '검색 처리 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
