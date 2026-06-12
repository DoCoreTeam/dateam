import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TYPES = ['hyperscaler', 'specialist', 'marketplace', 'domestic']

// PATCH /api/pricing/gpu/competitors/[id] — 경쟁사 수정
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'ID 형식 오류' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const str = (v: unknown) => (typeof v === 'string' ? (v.trim() || null) : undefined)
  for (const k of ['name', 'short_name', 'region', 'country', 'color', 'website_url', 'pricing_url'] as const) {
    const v = str(body[k])
    if (v !== undefined) patch[k] = v
  }
  if (patch.name === null) return NextResponse.json({ error: '경쟁사명은 비울 수 없습니다' }, { status: 400 })
  if (typeof body.type === 'string' && TYPES.includes(body.type)) patch.type = body.type
  if (typeof body.is_active === 'boolean') patch.is_active = body.is_active

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const { data, error } = await db.from('competitors').update(patch).eq('id', id).is('deleted_at', null).select().single()
  if (error) {
    console.error('[gpu/competitors PATCH]', error)
    return NextResponse.json({ error: '수정에 실패했습니다' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: '경쟁사를 찾을 수 없습니다' }, { status: 404 })

  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'market_price_updated',
    detail: { op: 'competitor_updated', competitor_id: id },
  })
  revalidateGpu()
  return NextResponse.json({ competitor: data })
}

// DELETE /api/pricing/gpu/competitors/[id] — 소프트 삭제(복구 가능)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'ID 형식 오류' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const { data, error } = await db
    .from('competitors')
    .update({ deleted_at: new Date().toISOString(), is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id, name')
    .single()
  if (error) {
    console.error('[gpu/competitors DELETE]', error)
    return NextResponse.json({ error: '삭제에 실패했습니다' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: '경쟁사를 찾을 수 없습니다' }, { status: 404 })

  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'market_price_updated',
    detail: { op: 'competitor_deleted', competitor_id: id, name: data.name },
  })
  revalidateGpu()
  return NextResponse.json({ ok: true })
}
