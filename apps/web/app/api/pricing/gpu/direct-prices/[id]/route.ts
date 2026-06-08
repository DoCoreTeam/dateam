import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'
import { countImpact } from '@/lib/gpu/impact'

// PATCH /api/pricing/gpu/direct-prices/[id] — 직접 판매가 수정
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }
  const patch: Record<string, unknown> = {}
  if ('sell_price_krw' in body) {
    const v = Number(body.sell_price_krw)
    if (isNaN(v) || v <= 0) return NextResponse.json({ error: '판매가는 양수' }, { status: 400 })
    patch.sell_price_krw = v
  }
  if ('note' in body) patch.note = (typeof body.note === 'string' && body.note.trim()) ? body.note.trim() : null
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '변경 필드 없음' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const { data, error } = await db.from('direct_prices').update(patch).eq('id', id).is('deleted_at', null).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: '직접 판매가를 찾을 수 없습니다' }, { status: 404 })

  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'direct_price_updated',
    productId: data.product_id ?? null,
    detail: { direct_price_id: id, patch },
  })

  revalidateGpu()
  return NextResponse.json({ direct: data })
}

// DELETE /api/pricing/gpu/direct-prices/[id] — 직접 판매가 소프트삭제 (해당 행 → 견적 기준으로 복귀)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params
  const force = new URL(req.url).searchParams.get('force') === 'true'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  const impact = await countImpact(db, 'direct_price', id)
  if ((impact.detail['is_current'] ?? 0) > 0 && !force) {
    return NextResponse.json({
      error: '현재 적용 중인 직접 판매가입니다. ?force=true로 강제 삭제할 수 있습니다.',
      impact: impact.detail,
    }, { status: 409 })
  }

  // 소프트삭제 + is_current 비활성화
  const { data, error } = await db
    .from('direct_prices')
    .update({ deleted_at: new Date().toISOString(), is_current: false })
    .eq('id', id)
    .is('deleted_at', null)
    .select('product_id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'direct_price_deleted',
    productId: data?.product_id ?? null,
    detail: { direct_price_id: id, force },
  })

  revalidateGpu()
  return NextResponse.json({ ok: true })
}
