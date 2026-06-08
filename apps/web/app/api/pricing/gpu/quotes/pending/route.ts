import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('supply_quotes')
      .select('*, suppliers(name, color, location), gpu_products(model_name, memory, tier)')
      .eq('status', 'pending')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (error) throw error

    return NextResponse.json({ quotes: data ?? [] })
  } catch (err) {
    console.error('[pricing/quotes/pending]', err)
    return NextResponse.json({ error: 'Failed to fetch pending quotes' }, { status: 500 })
  }
}
