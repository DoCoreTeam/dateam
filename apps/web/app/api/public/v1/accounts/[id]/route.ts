import type { NextRequest } from 'next/server'
import { authenticatePublicApi, optionsResponse } from '@/lib/publicApiAuth'
import { ok, notFound, serverError } from '@/lib/public-api/respond'
import { guardOwnedRow } from '@/lib/public-api/owned-row'
import { createAdminClient } from '@/lib/supabase/server'

interface Ctx { params: Promise<{ id: string }> }

const ALLOWED_FIELDS = [
  'name', 'industry', 'segment', 'size', 'region', 'website', 'phone', 'address',
  'description', 'fit_score', 'fit_reason', 'tags', 'source', 'account_type',
  'gpu_demand_intensity', 'registration_number', 'owner_user_id',
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
    const { data, error } = await admin.from('accounts').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    if (!data) return notFound({ ctx: auth.ctx, request })
    return ok(data, { ctx: auth.ctx, request })
  } catch (err) {
    return serverError('accounts/:id GET', err, { ctx: auth.ctx, request })
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    const raw = await request.json()
    const body = Object.fromEntries(ALLOWED_FIELDS.filter(k => k in raw).map(k => [k, raw[k]]))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    // RLS 의 accounts_update_own·accounts_delete_own 과 같은 판정 — 서비스 롤이라 앱이 다시 본다
    const denied = await guardOwnedRow(admin, 'accounts', id, auth.ctx, request)
    if (denied) return denied

    const { data, error } = await admin.from('accounts').update(body).eq('id', id).select().maybeSingle()
    if (error) throw error
    if (!data) return notFound({ ctx: auth.ctx, request })
    return ok(data, { ctx: auth.ctx, request })
  } catch (err) {
    return serverError('accounts/:id PATCH', err, { ctx: auth.ctx, request })
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    // RLS 의 accounts_update_own·accounts_delete_own 과 같은 판정 — 서비스 롤이라 앱이 다시 본다
    const denied = await guardOwnedRow(admin, 'accounts', id, auth.ctx, request)
    if (denied) return denied

    const { error } = await admin.from('accounts').delete().eq('id', id)
    if (error) throw error
    return ok(null, { ctx: auth.ctx, request })
  } catch (err) {
    return serverError('accounts/:id DELETE', err, { ctx: auth.ctx, request })
  }
}
