import type { NextRequest } from 'next/server'
import { authenticatePublicApi, optionsResponse, requireAdminKey } from '@/lib/publicApiAuth'
import { ok, okList, fail, serverError } from '@/lib/public-api/respond'
import { createAdminClient } from '@/lib/supabase/server'
import { parseListCursor, cursorFilter } from '@/lib/public-api/cursor'
import { withWriteAudit } from '@/lib/public-api/write-audit'

const LIMIT = 20
const SORT_ALLOW = new Set(['created_at', 'name', 'title', 'department'])
const ALLOWED_FIELDS = ['account_id', 'name', 'title', 'department', 'email', 'phone', 'mobile', 'linkedin', 'notes', 'business_card_drive_id', 'role'] as const

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function GET(request: NextRequest) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error
  // 내부 창구(/api/accounts 등)가 requireAdminApi 이므로 키도 같은 선을 지킨다, 화면보다 API 가 더 할 수 있으면 안 된다
  const denied = requireAdminKey(auth.ctx, request)
  if (denied) return denied

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
      const cursor = parseListCursor(cursorRaw)
      if (cursor) query = query.or(cursorFilter(cursor))
      query = query.limit(LIMIT + 1)
    }

    const { data, error } = await query
    if (error) throw error

    if (hasFilters) {
      const capped = data.length > CAP
      return okList(
        capped ? data.slice(0, CAP) : data,
        { nextCursor: null, hasMore: false, capped },
        { ctx: auth.ctx, request }
      )
    }

    const hasMore = data.length > LIMIT
    const items = hasMore ? data.slice(0, LIMIT) : data
    const last = items[items.length - 1]
    const nextCursor = hasMore && last ? `${last.created_at}__${last.id}` : null
    return okList(items, { nextCursor, hasMore }, { ctx: auth.ctx, request })
  } catch (err) {
    return serverError('contacts GET', err, { ctx: auth.ctx, request })
  }
}

export async function POST(request: NextRequest) {
  return withWriteAudit('public.contacts.post', async () => {
    const auth = await authenticatePublicApi(request)
    if ('error' in auth) return auth.error
    // 내부 창구(/api/accounts 등)가 requireAdminApi 이므로 키도 같은 선을 지킨다, 화면보다 API 가 더 할 수 있으면 안 된다
    const denied = requireAdminKey(auth.ctx, request)
    if (denied) return denied

    try {
      const raw = await request.json() as Record<string, unknown>
      if (!raw.name || String(raw.name).trim() === '') {
        return fail(400, 'name is required', { ctx: auth.ctx, request })
      }

      const body = Object.fromEntries(ALLOWED_FIELDS.filter(k => k in raw).map(k => [k, raw[k]]))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createAdminClient() as any
      const { data, error } = await admin.from('contacts').insert(Object.assign({}, body, { user_id: auth.ctx.userId })).select().single()
      if (error) throw error
      return ok(data, { ctx: auth.ctx, request, status: 201 })
    } catch (err) {
      return serverError('contacts POST', err, { ctx: auth.ctx, request })
    }
  })(request, undefined)
}
