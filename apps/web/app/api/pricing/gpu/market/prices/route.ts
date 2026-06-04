import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// DELETE /api/pricing/gpu/market/prices?id=<priceId> — 잘못 입력된 경쟁가 삭제
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createAdminClient() as any
    const { error } = await db.from('market_prices').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[market/prices DELETE]', err)
    return NextResponse.json({ error: 'Failed to delete price' }, { status: 500 })
  }
}

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
