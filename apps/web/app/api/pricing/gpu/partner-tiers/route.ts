import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('partner_tiers')
    .select('id, name, discount_rate')
    .order('discount_rate', { ascending: false })
  return NextResponse.json({ tiers: data ?? [] })
}
