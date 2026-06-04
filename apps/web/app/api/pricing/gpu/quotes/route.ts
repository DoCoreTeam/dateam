import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ensureSupplierAccount } from '@/lib/gpu/supplier-create'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const productId = searchParams.get('product_id')
    if (!productId) return NextResponse.json({ error: 'product_id required' }, { status: 400 })

    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { data, error } = await db
      .from('supply_quotes')
      .select('*, suppliers(name, color, location)')
      .eq('product_id', productId)
      .eq('status', 'confirmed')
      .order('unit_price_usd', { ascending: true })

    if (error) throw error

    return NextResponse.json({ quotes: data ?? [] })
  } catch (err) {
    console.error('[pricing/quotes GET]', err)
    return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    const body = await request.json()
    const {
      product_id, supplier_id, supplier_name, unit_price_usd, original_currency,
      original_price, original_unit, term, min_qty, valid_until,
      source_format, evidence_drive_file_id, evidence_hash, ai_confidence,
    } = body

    if (!product_id || !unit_price_usd) {
      return NextResponse.json({ error: 'product_id and unit_price_usd are required' }, { status: 400 })
    }

    // Find or create supplier from name if supplier_id not provided
    const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#3b82f6','#ec4899','#14b8a6','#f97316','#84cc16']
    let finalSupplierId = supplier_id || null
    if (!finalSupplierId && supplier_name?.trim()) {
      const { data: existing } = await db
        .from('suppliers')
        .select('id')
        .ilike('name', supplier_name.trim())
        .maybeSingle()
      if (existing) {
        finalSupplierId = existing.id
      } else {
        const color = COLORS[Math.floor(Math.random() * COLORS.length)]
        const { data: created } = await db
          .from('suppliers')
          .insert({ name: supplier_name.trim(), color, location: null, source: 'integrated' })
          .select('id, name, country, website, description, color, logo_url')
          .single()
        finalSupplierId = created?.id ?? null
        // 회사=accounts 통합 — 통합입력 자동생성 공급사도 account 링크
        if (created?.id) { try { await ensureSupplierAccount(createAdminClient(), created, user.id) } catch { /* 비치명적 */ } }
      }
    }

    const { data, error } = await db
      .from('supply_quotes')
      .insert({
        product_id, supplier_id: finalSupplierId, unit_price_usd: Number(unit_price_usd),
        original_currency, original_price: original_price ? Number(original_price) : null,
        original_unit, term, min_qty, valid_until: valid_until || null,
        source_format: source_format || 'text',
        evidence_drive_file_id: evidence_drive_file_id || null,
        evidence_hash: evidence_hash || null,
        ai_confidence: ai_confidence ? Number(ai_confidence) : null,
        status: 'pending',
        received_at: new Date().toISOString(),
        registered_by: user.email,
      })
      .select()
      .single()

    if (error) throw error

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminDb = createAdminClient() as any
    await adminDb.from('gpu_audit_logs').insert({
      action_type: 'quote_registered',
      actor: user.email,
      product_id,
      detail: { quote_id: data.id, unit_price_usd, supplier_id: finalSupplierId },
      evidence_ref: evidence_drive_file_id ?? data.id,
    })

    return NextResponse.json({ quote: data })
  } catch (err) {
    console.error('[pricing/quotes POST]', err)
    return NextResponse.json({ error: 'Failed to create quote' }, { status: 500 })
  }
}
