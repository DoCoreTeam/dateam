import type { NextRequest } from 'next/server'
import { authenticatePublicApi, optionsResponse, requireAdminKey } from '@/lib/publicApiAuth'
import { ok, okList, fail, serverError } from '@/lib/public-api/respond'
import { createAdminClient } from '@/lib/supabase/server'
import { parseListCursor, cursorFilter } from '@/lib/public-api/cursor'

const LIMIT = 20
/** 만들 때 받는 칸, accounts/[id] PATCH 와 같은 목록. id user_id created_at deleted_at 은 받지 않는다 */
const ALLOWED_FIELDS = [
  'name', 'industry', 'segment', 'size', 'region', 'website', 'phone', 'address',
  'description', 'fit_score', 'fit_reason', 'tags', 'source', 'account_type',
  'gpu_demand_intensity', 'registration_number', 'owner_user_id',
] as const
const SORT_ALLOW = new Set(['created_at', 'name', 'fit_score', 'industry', 'region', 'segment', 'gpu_demand_intensity'])

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
    const segment = sp.get('segment')?.trim() || ''
    const industry = sp.get('industry')?.trim() || ''
    const region = sp.get('region')?.trim() || ''
    const sortField = SORT_ALLOW.has(sp.get('sort') ?? '') ? sp.get('sort')! : 'created_at'
    const sortAsc = sp.get('dir') === 'asc'

    const hasFilters = search || segment || industry || region || sortField !== 'created_at'

    let query = admin
      .from('accounts')
      .select('*')
      .order(sortField, { ascending: sortAsc })
      .order('id', { ascending: false })

    if (search) query = query.ilike('name', `%${search}%`)
    if (segment) query = query.eq('segment', segment)
    if (industry) query = query.ilike('industry', `%${industry}%`)
    if (region) query = query.ilike('region', `%${region}%`)

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
    return serverError('accounts GET', err, { ctx: auth.ctx, request })
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error
  // 내부 창구(/api/accounts 등)가 requireAdminApi 이므로 키도 같은 선을 지킨다, 화면보다 API 가 더 할 수 있으면 안 된다
  const denied = requireAdminKey(auth.ctx, request)
  if (denied) return denied

  try {
    const raw = await request.json()
    const body: Record<string, unknown> = Object.fromEntries(ALLOWED_FIELDS.filter((k) => k in raw).map((k) => [k, raw[k]]))
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return fail(400, 'name is required', { ctx: auth.ctx, request })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data, error } = await admin
      .from('accounts')
      .insert(Object.assign({}, body, { user_id: auth.ctx.userId }))
      .select()
      .single()

    if (error) throw error
    return ok(data, { ctx: auth.ctx, request, status: 201 })
  } catch (err) {
    return serverError('accounts POST', err, { ctx: auth.ctx, request })
  }
}
