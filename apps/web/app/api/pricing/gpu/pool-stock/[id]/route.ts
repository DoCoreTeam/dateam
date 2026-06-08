import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'
import { countImpact } from '@/lib/gpu/impact'

// PATCH /api/pricing/gpu/pool-stock/[id] — T3 풀 재고 수정
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }
  const patch: Record<string, unknown> = {}
  for (const k of ['pool_qty', 'note'] as const) if (k in body) patch[k] = body[k] === '' ? null : body[k]
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '변경 필드 없음' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (createAdminClient() as any).from('direct_pool_stock').update(patch).eq('id', id).is('deleted_at', null).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: '풀 재고를 찾을 수 없습니다' }, { status: 404 })
  revalidateGpu()
  return NextResponse.json({ pool: data })
}

// DELETE /api/pricing/gpu/pool-stock/[id] — T3 풀 재고 소프트삭제
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params
  const force = new URL(req.url).searchParams.get('force') === 'true'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  const impact = await countImpact(db, 'pool_stock', id)
  if ((impact.detail['is_current'] ?? 0) > 0 && !force) {
    return NextResponse.json({
      error: '현재 적용 중인 풀 재고입니다. ?force=true로 강제 삭제할 수 있습니다.',
      impact: impact.detail,
    }, { status: 409 })
  }

  const { data, error } = await db
    .from('direct_pool_stock')
    .update({ deleted_at: new Date().toISOString(), is_current: false })
    .eq('id', id)
    .is('deleted_at', null)
    .select('product_id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'pool_stock_deleted',
    productId: data?.product_id ?? null,
    detail: { pool_stock_id: id, force },
  })

  revalidateGpu()
  return NextResponse.json({ ok: true })
}
