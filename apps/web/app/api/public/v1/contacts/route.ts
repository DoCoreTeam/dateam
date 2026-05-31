import { NextRequest, NextResponse } from 'next/server'
import { authenticatePublicApi, corsHeaders, optionsResponse } from '@/lib/publicApiAuth'
import { createAdminClient } from '@/lib/supabase/server'

const LIMIT = 20
const SORT_ALLOW = new Set(['created_at', 'name', 'title', 'department'])
const ALLOWED_FIELDS = ['account_id', 'name', 'title', 'department', 'email', 'phone', 'mobile', 'linkedin', 'notes', 'business_card_drive_id', 'role'] as const

export async function OPTIONS() {
  return optionsResponse()
}

export async function GET(request: NextRequest) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const sp = request.nextUrl.searchParams
    const cursorRaw = sp.get('cursor')
    const search = sp.get('search')?.trim() || ''
    const sortField = SORT_ALLOW.has(sp.get('sort') ?? '') ? sp.get('sort')! : 'created_at'
    const sortAsc = sp.get('dir') === 'asc'

    const hasFilters = !!search || sortField !== 'created_at'

    let query = admin
      .from('contacts')
      .select('*, accounts(name)')
      .order(sortField, { ascending: sortAsc })
      .order('id', { ascending: false })

    if (search) query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`)

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
    if (error) throw error

    if (hasFilters) {
      const capped = data.length > CAP
      return NextResponse.json(
        { success: true, data: capped ? data.slice(0, CAP) : data, nextCursor: null, hasMore: false, capped },
        { headers: corsHeaders() }
      )
    }

    const hasMore = data.length > LIMIT
    const items = hasMore ? data.slice(0, LIMIT) : data
    const last = items[items.length - 1]
    const nextCursor = hasMore && last ? `${last.created_at}__${last.id}` : null
    return NextResponse.json({ success: true, data: items, nextCursor, hasMore }, { headers: corsHeaders() })
  } catch (err) {
    console.error('[public/v1/contacts GET]', err)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500, headers: corsHeaders() })
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  try {
    const raw = await request.json() as Record<string, unknown>
    if (!raw.name || String(raw.name).trim() === '') {
      return NextResponse.json({ success: false, error: 'name is required' }, { status: 400, headers: corsHeaders() })
    }

    const body = Object.fromEntries(ALLOWED_FIELDS.filter(k => k in raw).map(k => [k, raw[k]]))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data, error } = await admin.from('contacts').insert({ ...body, user_id: auth.ctx.userId }).select().single()
    if (error) throw error
    return NextResponse.json({ success: true, data }, { status: 201, headers: corsHeaders() })
  } catch (err) {
    console.error('[public/v1/contacts POST]', err)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500, headers: corsHeaders() })
  }
}
