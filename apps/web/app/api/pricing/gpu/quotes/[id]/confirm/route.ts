import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminDb = createAdminClient() as any
    const actor = auth.user.email ?? auth.user.id

    const { data: quote, error: fetchErr } = await adminDb
      .from('supply_quotes')
      .select('*, gpu_products(id, model_name, memory, tier)')
      .eq('id', params.id)
      .single()

    if (fetchErr || !quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

    // 정합성 가드 — 공급사/상품 없는 견적은 확정 불가 (가격표 "공급사 미지정" 재발 방지)
    if (!quote.supplier_id) {
      return NextResponse.json({ error: '공급사가 지정되지 않은 견적은 확정할 수 없습니다. 공급사를 먼저 지정하세요.' }, { status: 400 })
    }
    if (!quote.product_id) {
      return NextResponse.json({ error: '상품(GPU 모델)이 연결되지 않은 견적은 확정할 수 없습니다.' }, { status: 400 })
    }

    const now = new Date().toISOString()

    // 멱등: 동일 (상품·공급사·계약기간) 기존 confirmed 견적을 superseded로 이력화
    // (부분 유니크 인덱스 위반 방지 + 공급사당 활성 1건 유지)
    if (quote.product_id && quote.supplier_id) {
      let supQ = adminDb
        .from('supply_quotes')
        .update({ status: 'superseded' })
        .eq('product_id', quote.product_id)
        .eq('supplier_id', quote.supplier_id)
        .eq('status', 'confirmed')
        .neq('id', params.id)
      supQ = quote.term_months == null ? supQ.is('term_months', null) : supQ.eq('term_months', quote.term_months)
      await supQ
    }

    const { error } = await adminDb
      .from('supply_quotes')
      .update({ status: 'confirmed', confirmed_by: actor, confirmed_at: now })
      .eq('id', params.id)

    if (error) throw error

    await recordGpuAudit(adminDb, {
      actor,
      actionType: 'quote_confirmed',
      productId: (quote.gpu_products as Record<string, unknown>)?.id as string ?? null,
      detail: {
        quote_id: params.id,
        unit_price_usd: quote.unit_price_usd,
        supplier_id: quote.supplier_id,
      },
    })

    revalidateGpu()
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[quotes/confirm]', err)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }
}
