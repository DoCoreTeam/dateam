import type { NextRequest } from 'next/server'
import { authenticatePublicApi, optionsResponse, requireAdminKey } from '@/lib/publicApiAuth'
import { ok, okList, fail, serverError } from '@/lib/public-api/respond'
import { createAdminClient } from '@/lib/supabase/server'
import { parseListCursor, cursorFilter } from '@/lib/public-api/cursor'
import { probabilityForStage } from '@/lib/crm'

const LIMIT = 20
const SORT_ALLOW = new Set(['created_at', 'title', 'stage', 'value', 'probability'])

/** 만들 때 받는 칸, deals/[id] PATCH 와 같은 목록. id user_id created_at deleted_at probability 는 받지 않는다 */
const ALLOWED_FIELDS = [
  'title', 'description', 'stage', 'value', 'close_date', 'next_action',
  'next_action_date', 'account_id', 'contact_id', 'tags', 'lead_type',
  'product', 'fit_score', 'hw_included', 'is_new_deal', 'expected_date',
  'funding_source', 'procurement_status', 'source',
] as const

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
    const stage = sp.get('stage')?.trim() || ''
    const sortField = SORT_ALLOW.has(sp.get('sort') ?? '') ? sp.get('sort')! : 'created_at'
    const sortAsc = sp.get('dir') === 'asc'

    const hasFilters = !!search || !!stage || sortField !== 'created_at'

    let query = admin
      .from('deals')
      .select('*, accounts(name)')
      .order(sortField, { ascending: sortAsc })
      .order('id', { ascending: false })

    if (search) query = query.ilike('title', `%${search}%`)
    if (stage) query = query.eq('stage', stage)

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

    const { count } = await admin
      .from('deals')
      .select('*', { count: 'exact', head: true })
      .neq('stage', '실패')
    const total = count ?? 0

    if (hasFilters) {
      const capped = data.length > CAP
      return okList(
        capped ? data.slice(0, CAP) : data,
        { nextCursor: null, hasMore: false, capped, total },
        { ctx: auth.ctx, request }
      )
    }

    const hasMore = data.length > LIMIT
    const items = hasMore ? data.slice(0, LIMIT) : data
    const last = items[items.length - 1]
    const nextCursor = hasMore && last ? `${last.created_at}__${last.id}` : null
    return okList(items, { nextCursor, hasMore, total }, { ctx: auth.ctx, request })
  } catch (err) {
    return serverError('deals GET', err, { ctx: auth.ctx, request })
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
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return fail(400, 'title is required', { ctx: auth.ctx, request })
    }

    const stage = typeof body.stage === 'string' ? body.stage : '신규'
    const row = Object.assign({}, body, { stage, probability: probabilityForStage(stage), user_id: auth.ctx.userId })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data, error } = await admin
      .from('deals')
      .insert(row)
      .select()
      .single()

    if (error) throw error
    return ok(data, { ctx: auth.ctx, request, status: 201 })
  } catch (err) {
    return serverError('deals POST', err, { ctx: auth.ctx, request })
  }
}
