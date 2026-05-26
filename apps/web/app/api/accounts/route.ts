import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { safeLike, safeEq } from '@/lib/postgrest-safe'

const LIMIT = 20
const SORT_ALLOW = new Set(['created_at', 'name', 'fit_score', 'industry', 'region', 'segment'])

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const cursorRaw = sp.get('cursor')
  const search    = safeLike(sp.get('search') ?? '')
  const segment   = safeEq(sp.get('segment') ?? '')
  const industry  = safeLike(sp.get('industry') ?? '')
  const region    = safeLike(sp.get('region') ?? '')
  const sortField = SORT_ALLOW.has(sp.get('sort') ?? '') ? sp.get('sort')! : 'created_at'
  const sortAsc   = sp.get('dir') === 'asc'

  const hasFilters = search || segment || industry || region || sortField !== 'created_at'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from('accounts')
    .select('*')
    .order(sortField, { ascending: sortAsc })
    .order('id', { ascending: false })

  if (search)   query = query.ilike('name', `%${search}%`)
  if (segment)  query = query.eq('segment', segment)
  if (industry) query = query.ilike('industry', `%${industry}%`)
  if (region)   query = query.ilike('region', `%${region}%`)

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

  const body = await req.json()
  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (adminClient as any)
    .from('accounts')
    .insert({ ...body, user_id: user.id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
