import type { NextRequest } from 'next/server'
import { authenticatePublicApi, optionsResponse } from '@/lib/publicApiAuth'
import { ok, okList, fail, serverError } from '@/lib/public-api/respond'
import { createAdminClient } from '@/lib/supabase/server'

const LIMIT = 20
const SORT_ALLOW = new Set(['created_at', 'name', 'fit_score', 'industry', 'region', 'segment', 'gpu_demand_intensity'])

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
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

  try {
    const body = await request.json()
    if (!body.name?.trim()) {
      return fail(400, 'name is required', { ctx: auth.ctx, request })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data, error } = await admin
      .from('accounts')
      .insert({ ...body, user_id: auth.ctx.userId })
      .select()
      .single()

    if (error) throw error
    return ok(data, { ctx: auth.ctx, request, status: 201 })
  } catch (err) {
    return serverError('accounts POST', err, { ctx: auth.ctx, request })
  }
}
