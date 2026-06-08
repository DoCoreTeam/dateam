import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'
import { countImpact } from '@/lib/gpu/impact'

const VALID_STATUSES = ['available_full', 'available_partial', 'out_of_stock', 'declined', 'pending'] as const

// PATCH /api/pricing/gpu/availability/[id] — 재고(가용량) 응답 수정
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }

  const patch: Record<string, unknown> = {}

  if ('status' in body) {
    if (!VALID_STATUSES.includes(body.status as typeof VALID_STATUSES[number])) {
      return NextResponse.json({ error: `status는 ${VALID_STATUSES.join('|')} 중 하나` }, { status: 400 })
    }
    patch.status = body.status
  }
  if ('resp_qty' in body) {
    if (body.resp_qty === null || body.resp_qty === '') { patch.resp_qty = null }
    else {
      const v = Number(body.resp_qty)
      if (!Number.isFinite(v) || v < 0) return NextResponse.json({ error: 'resp_qty는 0 이상 숫자여야 합니다' }, { status: 400 })
      patch.resp_qty = Math.round(v)
    }
  }
  if ('our_qty' in body) {
    if (body.our_qty === null || body.our_qty === '') { patch.our_qty = null }
    else {
      const v = Number(body.our_qty)
      if (!Number.isFinite(v) || v < 0) return NextResponse.json({ error: 'our_qty는 0 이상 숫자여야 합니다' }, { status: 400 })
      patch.our_qty = Math.round(v)
    }
  }
  if ('unit_price_usd' in body) {
    if (body.unit_price_usd === null || body.unit_price_usd === '') { patch.unit_price_usd = null }
    else {
      const v = Number(body.unit_price_usd)
      if (!Number.isFinite(v) || v < 0) return NextResponse.json({ error: 'unit_price_usd는 0 이상 숫자여야 합니다' }, { status: 400 })
      patch.unit_price_usd = v
    }
  }
  if ('expires_at' in body) {
    patch.expires_at = (body.expires_at === '' || body.expires_at === null) ? null : body.expires_at
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '변경 필드 없음' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const { data, error } = await db.from('availability_responses').update(patch).eq('id', id).is('deleted_at', null).select().single()
  if (error) {
    console.error('[availability/[id] PATCH]', error)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: '가용량 응답을 찾을 수 없습니다' }, { status: 404 })

  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'availability_registered',
    productId: data.product_id ?? null,
    detail: { availability_id: id, patch },
  })

  revalidateGpu()
  return NextResponse.json({ availability: data })
}

// DELETE /api/pricing/gpu/availability/[id] — 재고 응답 소프트삭제
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params
  const force = new URL(req.url).searchParams.get('force') === 'true'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  const impact = await countImpact(db, 'availability_response', id)
  if ((impact.detail['is_current'] ?? 0) > 0 && !force) {
    return NextResponse.json({
      error: '현재 적용 중인 가용량 응답입니다. ?force=true로 강제 삭제할 수 있습니다.',
      impact: impact.detail,
    }, { status: 409 })
  }

  const { data, error } = await db
    .from('availability_responses')
    .update({ deleted_at: new Date().toISOString(), is_current: false })
    .eq('id', id)
    .is('deleted_at', null)
    .select('product_id')
    .single()

  if (error) {
    console.error('[availability/[id] DELETE]', error)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }

  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'availability_deleted',
    productId: data?.product_id ?? null,
    detail: { availability_id: id, force },
  })

  revalidateGpu()
  return NextResponse.json({ ok: true })
}
