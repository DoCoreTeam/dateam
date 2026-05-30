import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { mapping_id, price_usd, source_url, source_type, pricing_model, notes } = body

    if (!mapping_id || !price_usd) {
      return NextResponse.json({ error: 'mapping_id and price_usd are required' }, { status: 400 })
    }
    if (typeof price_usd !== 'number' || price_usd <= 0) {
      return NextResponse.json({ error: 'price_usd must be a positive number' }, { status: 400 })
    }

    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    const now = new Date().toISOString()
    const { data, error } = await db.from('market_prices').insert({
      mapping_id,
      price_usd,
      source_url: source_url || null,
      source_type: source_type || 'manual',
      notes: notes || null,
      recorded_at: now,
      observed_at: now,
      confidence: 90,
      is_stale: false,
    }).select().single()

    if (error) throw error

    return NextResponse.json({ success: true, data })
  } catch (err) {
    console.error('[market/prices POST]', err)
    return NextResponse.json({ error: 'Failed to register price' }, { status: 500 })
  }
}
