import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    const { data: quote, error: fetchErr } = await db
      .from('supply_quotes')
      .select('*, gpu_products(id, model_name, memory, tier)')
      .eq('id', params.id)
      .single()

    if (fetchErr || !quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

    const now = new Date().toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminDb = createAdminClient() as any

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

    const { error } = await db
      .from('supply_quotes')
      .update({ status: 'confirmed', confirmed_by: user.email, confirmed_at: now })
      .eq('id', params.id)

    if (error) throw error

    await adminDb.from('gpu_audit_logs').insert({
      action_type: 'quote_confirmed',
      actor: user.email,
      product_id: (quote.gpu_products as Record<string, unknown>)?.id as string,
      detail: {
        quote_id: params.id,
        unit_price_usd: quote.unit_price_usd,
        supplier_id: quote.supplier_id,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[quotes/confirm]', err)
    return NextResponse.json({ error: 'Failed to confirm quote' }, { status: 500 })
  }
}
