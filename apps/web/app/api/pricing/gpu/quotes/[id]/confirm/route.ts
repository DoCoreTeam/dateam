import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
    const { error } = await db
      .from('supply_quotes')
      .update({ status: 'confirmed', confirmed_by: user.email, confirmed_at: now })
      .eq('id', params.id)

    if (error) throw error

    await db.from('gpu_audit_logs').insert({
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
