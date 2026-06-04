import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'

// DELETE /api/pricing/gpu/direct-prices?product_id= — 직접 판매가 해제(견적 기준으로 복귀)
export async function DELETE(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const product_id = new URL(req.url).searchParams.get('product_id')
  if (!product_id) return NextResponse.json({ error: 'product_id 필요' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (createAdminClient() as any).from('direct_prices').delete().eq('product_id', product_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateGpu()
  return NextResponse.json({ ok: true })
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    const body = await request.json()
    const { product_id, sell_price_krw, note } = body

    if (!product_id || !sell_price_krw) {
      return NextResponse.json({ error: 'product_id and sell_price_krw required' }, { status: 400 })
    }

    // Mark all previous prices as not current
    await db
      .from('direct_prices')
      .update({ is_current: false })
      .eq('product_id', product_id)
      .eq('is_current', true)

    const { data, error } = await db
      .from('direct_prices')
      .insert({
        product_id,
        sell_price_krw: Number(sell_price_krw),
        note: note || null,
        set_by: user.email,
        is_current: true,
      })
      .select()
      .single()

    if (error) throw error

    await db.from('gpu_audit_logs').insert({
      action_type: 'direct_set',
      actor: user.email,
      product_id,
      detail: { sell_price_krw: Number(sell_price_krw), note },
    })

    return NextResponse.json({ price: data })
  } catch (err) {
    console.error('[direct-prices POST]', err)
    return NextResponse.json({ error: 'Failed to set direct price' }, { status: 500 })
  }
}
