import type { NextRequest } from 'next/server'
import { authenticatePublicApi, optionsResponse } from '@/lib/publicApiAuth'
import { ok, notFound, serverError } from '@/lib/public-api/respond'
import { guardOwnedRow } from '@/lib/public-api/owned-row'
import { createAdminClient } from '@/lib/supabase/server'
import { probabilityForStage } from '@/lib/crm'

interface Ctx { params: Promise<{ id: string }> }

const ALLOWED_FIELDS = [
  'title', 'description', 'stage', 'value', 'close_date', 'next_action',
  'next_action_date', 'account_id', 'contact_id', 'tags', 'lead_type',
  'product', 'fit_score', 'hw_included', 'is_new_deal', 'expected_date',
  'funding_source', 'procurement_status', 'source',
] as const

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data, error } = await admin.from('deals').select('*, accounts(name)').eq('id', id).maybeSingle()
    if (error) throw error
    if (!data) return notFound({ ctx: auth.ctx, request })
    return ok(data, { ctx: auth.ctx, request })
  } catch (err) {
    return serverError('deals/:id GET', err, { ctx: auth.ctx, request })
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    const raw = await request.json()
    const body: Record<string, unknown> = Object.fromEntries(ALLOWED_FIELDS.filter(k => k in raw).map(k => [k, raw[k]]))
    if (typeof body.stage === 'string') body.probability = probabilityForStage(body.stage)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    // RLS 의 deals_update_own·deals_delete_own 과 같은 판정 — 서비스 롤이라 앱이 다시 본다
    const denied = await guardOwnedRow(admin, 'deals', id, auth.ctx, request)
    if (denied) return denied

    const { data, error } = await admin.from('deals').update(body).eq('id', id).select().maybeSingle()
    if (error) throw error
    if (!data) return notFound({ ctx: auth.ctx, request })
    return ok(data, { ctx: auth.ctx, request })
  } catch (err) {
    return serverError('deals/:id PATCH', err, { ctx: auth.ctx, request })
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    // RLS 의 deals_update_own·deals_delete_own 과 같은 판정 — 서비스 롤이라 앱이 다시 본다
    const denied = await guardOwnedRow(admin, 'deals', id, auth.ctx, request)
    if (denied) return denied

    const { error } = await admin.from('deals').delete().eq('id', id)
    if (error) throw error
    return ok(null, { ctx: auth.ctx, request })
  } catch (err) {
    return serverError('deals/:id DELETE', err, { ctx: auth.ctx, request })
  }
}
