import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const LIMIT = 20
  const cursorRaw = req.nextUrl.searchParams.get('cursor')
  const [cursorTime, cursorId] = cursorRaw ? cursorRaw.split('__') : [null, null]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from('deals')
    .select('*, accounts(name)')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(LIMIT + 1)

  if (cursorTime && cursorId) {
    query = query.or(`created_at.lt.${cursorTime},and(created_at.eq.${cursorTime},id.lt.${cursorId})`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const hasMore = data.length > LIMIT
  const items = hasMore ? data.slice(0, LIMIT) : data
  const last = items[items.length - 1]
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
    .from('deals').insert({ ...body, user_id: user.id }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
