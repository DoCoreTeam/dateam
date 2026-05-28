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
      .select('product_id')
      .eq('id', params.id)
      .single()

    if (fetchErr || !quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

    const { error } = await db
      .from('supply_quotes')
      .update({ status: 'rejected' })
      .eq('id', params.id)

    if (error) throw error

    await db.from('gpu_audit_logs').insert({
      action_type: 'rejected',
      actor: user.email,
      product_id: (quote as Record<string, unknown>).product_id as string,
      detail: { quote_id: params.id },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[quotes/reject]', err)
    return NextResponse.json({ error: 'Failed to reject quote' }, { status: 500 })
  }
}
