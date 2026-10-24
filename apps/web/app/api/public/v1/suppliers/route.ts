import { NextRequest, NextResponse } from 'next/server'
import { authenticatePublicApi, optionsResponse, requireAdminKey, requireMemberKey } from '@/lib/publicApiAuth'
import { fail, ok, responseHeaders, serverError } from '@/lib/public-api/respond'
import { readJsonBody, INVALID_JSON_MESSAGE } from '@/lib/public-api/read-json'
import { createAdminClient } from '@/lib/supabase/server'
import { withWriteAudit } from '@/lib/public-api/write-audit'

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function GET(request: NextRequest) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error
  // 내부 창구가 requireMemberApi 인 자료다, 외부용 api_user 키는 막는다
  const denied = requireMemberKey(auth.ctx, request)
  if (denied) return denied

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any

    const { data: suppliers, error } = await admin
      .from('suppliers')
      .select('id, name, location, color, contact, created_at')
      .order('name')

    if (error) throw error

    const supplierIds = (suppliers ?? []).map((s: Record<string, unknown>) => s.id as string)

    const [activeRes, lowestRes, lastRes] = await Promise.all([
      supplierIds.length > 0
        ? admin.from('supply_quotes').select('supplier_id').in('supplier_id', supplierIds).eq('status', 'confirmed')
        : Promise.resolve({ data: [] }),
      supplierIds.length > 0
        ? admin.from('v_lowest_quotes').select('supplier_id').in('supplier_id', supplierIds)
        : Promise.resolve({ data: [] }),
      supplierIds.length > 0
        ? admin.from('supply_quotes').select('supplier_id, received_at').in('supplier_id', supplierIds).order('received_at', { ascending: false })
        : Promise.resolve({ data: [] }),
    ])

    const activeMap = new Map<string, number>()
    for (const q of activeRes.data ?? []) {
      const sid = (q as Record<string, unknown>).supplier_id as string
      activeMap.set(sid, (activeMap.get(sid) ?? 0) + 1)
    }

    const lowestMap = new Map<string, number>()
    for (const q of lowestRes.data ?? []) {
      const sid = (q as Record<string, unknown>).supplier_id as string
      lowestMap.set(sid, (lowestMap.get(sid) ?? 0) + 1)
    }

    const lastMap = new Map<string, string>()
    for (const q of lastRes.data ?? []) {
      const row = q as Record<string, unknown>
      const sid = row.supplier_id as string
      if (!lastMap.has(sid) && row.received_at) lastMap.set(sid, row.received_at as string)
    }

    const result = (suppliers ?? []).map((s: Record<string, unknown>) => ({
      ...s,
      active_quotes: activeMap.get(s.id as string) ?? 0,
      lowest_count: lowestMap.get(s.id as string) ?? 0,
      last_received: lastMap.get(s.id as string) ?? null,
    }))

    return NextResponse.json(
      { success: true, data: result, meta: { total: result.length } },
      { headers: responseHeaders({ ctx: auth.ctx, request }) }
    )
  } catch (err) {
    return serverError('suppliers GET', err, { ctx: auth.ctx, request })
  }
}

const INVALID_INPUT_PREFIX = '입력값을 확인해 주세요'

const COLORS = ['#7c3aed','#10b981','#f59e0b','#ef4444','#7c3aed','#3b82f6','#ec4899','#14b8a6','#f97316','#84cc16']

export async function POST(request: NextRequest) {
  return withWriteAudit('public.suppliers.post', async () => {
    const auth = await authenticatePublicApi(request, { scope: 'write' })
    if ('error' in auth) return auth.error
    // 내부 창구가 requireAdminApi 인 쓰기다, 키도 같은 선을 지킨다
    const denied = requireAdminKey(auth.ctx, request)
    if (denied) return denied

    try {
      const read = await readJsonBody(request)
      if (!read.ok) return fail(400, INVALID_JSON_MESSAGE, { ctx: auth.ctx, request })
      const body = (read.body ?? {}) as { name?: unknown; location?: unknown; contact?: unknown }
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name) return fail(400, `${INVALID_INPUT_PREFIX}: name`, { ctx: auth.ctx, request })
      const location = typeof body.location === 'string' ? body.location.trim() : ''
      const contact = typeof body.contact === 'string' ? body.contact.trim() : ''

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createAdminClient() as any
      const color = COLORS[Math.floor(Math.random() * COLORS.length)]
      const { data, error } = await admin
        .from('suppliers')
        .insert({ name, location: location || null, contact: contact || null, color })
        .select()
        .single()

      if (error) throw error

      return ok(data, { ctx: auth.ctx, request, status: 201 })
    } catch (err) {
      return serverError('suppliers POST', err, { ctx: auth.ctx, request })
    }
  })(request, undefined)
}
