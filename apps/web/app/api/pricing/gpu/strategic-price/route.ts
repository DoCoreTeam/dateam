// PATCH /api/pricing/gpu/strategic-price — 전략가 설정 / 해제
//
// body: { product_id: string, strategic_price_krw: number | null, reason?: string }
// - null  → 전략가 해제 (자동마진가 복귀)
// - number → 전략가 설정 (양수 정수, isFinite 필수)
//
// 게이트: requireAdminApi (관리자 전용)
// 감사: recordGpuAudit(actionType:'strategic_price_set')
// 캐시: revalidateGpu()

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { recordGpuAudit } from '@/lib/gpu/audit'
import { revalidateGpu } from '@/lib/gpu/revalidate'

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }

  const productId = typeof body.product_id === 'string' ? body.product_id.trim() : ''
  if (!productId) {
    return NextResponse.json({ error: 'product_id 필수' }, { status: 400 })
  }

  const rawPrice = body.strategic_price_krw
  let strategicPriceKrw: number | null

  if (rawPrice === null || rawPrice === undefined) {
    // null / undefined → 전략가 해제
    strategicPriceKrw = null
  } else {
    const n = Number(rawPrice)
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json(
        { error: 'strategic_price_krw는 양수여야 합니다 (null이면 해제)' },
        { status: 400 },
      )
    }
    strategicPriceKrw = Math.round(n)
  }

  const rawReason =
    typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null
  const reason = rawReason

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  // 변경 전 값 (감사 detail.before용)
  const { data: before, error: fetchErr } = await db
    .from('gpu_products')
    .select('id, strategic_price_krw, strategic_override_reason, strategic_set_by, strategic_set_at')
    .eq('id', productId)
    .is('deleted_at', null)
    .single()

  if (fetchErr || !before) {
    return NextResponse.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 })
  }

  const actor = auth.user.email ?? auth.user.id
  const now = new Date().toISOString()

  const patch =
    strategicPriceKrw === null
      ? {
          strategic_price_krw: null,
          strategic_override_reason: null,
          strategic_set_by: null,
          strategic_set_at: null,
        }
      : {
          strategic_price_krw: strategicPriceKrw,
          strategic_override_reason: reason,
          strategic_set_by: actor,
          strategic_set_at: now,
        }

  const { data: updated, error: updateErr } = await db
    .from('gpu_products')
    .update(patch)
    .eq('id', productId)
    .is('deleted_at', null)
    .select('id, strategic_price_krw, strategic_override_reason, strategic_set_by, strategic_set_at')
    .single()

  if (updateErr || !updated) {
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }

  await recordGpuAudit(db, {
    actor,
    actionType: 'strategic_price_set',
    productId,
    detail: {
      before: {
        strategic_price_krw: before.strategic_price_krw,
        reason: before.strategic_override_reason,
      },
      after: {
        strategic_price_krw: strategicPriceKrw,
        reason,
      },
      action: strategicPriceKrw === null ? 'clear' : 'set',
    },
  })

  revalidateGpu()

  return NextResponse.json({
    product_id: productId,
    strategic_price_krw: updated.strategic_price_krw,
    strategic_override_reason: updated.strategic_override_reason,
    strategic_set_by: updated.strategic_set_by,
    strategic_set_at: updated.strategic_set_at,
    action: strategicPriceKrw === null ? 'cleared' : 'set',
  })
}
