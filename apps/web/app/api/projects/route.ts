import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { safeLike } from '@/lib/postgrest-safe'
import { parseProjectMeta, PROJECT_SELECT, PROJECT_SORT_ALLOW } from '@/lib/work/project-fields'

// 경량 projects 엔티티 CRUD (본인 소유). 그룹핑 ③ 프로젝트 축의 그룹 키 원천.
// 패턴: accounts/contacts 라우트와 동형 — createClient(RLS) + user_id 소유, items/nextCursor 엔벨로프.
// mig111: year/quarter/half/month/start_date/end_date/budget/currency/status 메타.

const LIMIT = 20
const NAME_MAX = 200

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const cursorRaw = sp.get('cursor')
  const search    = safeLike(sp.get('search') ?? '')
  const sortField = PROJECT_SORT_ALLOW.has(sp.get('sort') ?? '') ? sp.get('sort')! : 'created_at'
  const sortAsc   = sp.get('dir') === 'asc'

  const hasFilters = Boolean(search) || sortField !== 'created_at'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from('projects')
    .select(PROJECT_SELECT)
    .is('deleted_at', null)
    .eq('user_id', user.id)
    .order(sortField, { ascending: sortAsc, nullsFirst: false })
    .order('id', { ascending: false })

  if (search) query = query.ilike('name', `%${search}%`)

  const CAP = 500
  if (hasFilters) {
    query = query.limit(CAP + 1)
  } else {
    const [cursorTime, cursorId] = cursorRaw ? cursorRaw.split('__') : [null, null]
    if (cursorTime && cursorId) {
      query = query.or(`created_at.lt.${cursorTime},and(created_at.eq.${cursorTime},id.lt.${cursorId})`)
    }
    query = query.limit(LIMIT + 1)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (hasFilters) {
    const capped = data.length > CAP
    return NextResponse.json({ items: capped ? data.slice(0, CAP) : data, nextCursor: null, hasMore: false, capped })
  }

  const hasMore = data.length > LIMIT
  const items   = hasMore ? data.slice(0, LIMIT) : data
  const last    = items[items.length - 1]
  const nextCursor = hasMore && last ? `${last.created_at}__${last.id}` : null
  return NextResponse.json({ items, nextCursor, hasMore })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = await req.json().catch(() => null) as Record<string, unknown> | null
  const name = typeof raw?.name === 'string' ? raw.name.trim() : ''
  if (!name) return NextResponse.json({ error: '프로젝트 이름은 필수입니다' }, { status: 400 })
  if (name.length > NAME_MAX) return NextResponse.json({ error: `이름은 ${NAME_MAX}자 이하여야 합니다` }, { status: 400 })

  const meta = parseProjectMeta(raw ?? {})
  if ('error' in meta) return NextResponse.json({ error: meta.error }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('projects')
    .insert({ name, user_id: user.id, ...meta.fields })
    .select(PROJECT_SELECT)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
