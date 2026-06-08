import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { ensureSupplierAccount } from '@/lib/gpu/supplier-create'
import { ensureStandardConfigs } from '@/lib/gpu/derive-configs'
import { roundUpToStandard } from '@/lib/gpu/config-ladder'
import { recordGpuAudit } from '@/lib/gpu/audit'

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
      .is('deleted_at', null)
      .order('unit_price_usd', { ascending: true })

    if (error) throw error

    return NextResponse.json({ quotes: data ?? [] })
  } catch (err) {
    console.error('[pricing/quotes GET]', err)
    return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }

  const {
    product_id, supplier_id, supplier_name, unit_price_usd, original_currency,
    original_price, original_unit, term, min_qty, valid_until,
    source_format, evidence_drive_file_id, evidence_hash, ai_confidence,
  } = body as Record<string, unknown>

  if (!product_id || typeof product_id !== 'string') {
    return NextResponse.json({ error: 'product_id 필수' }, { status: 400 })
  }
  if (typeof unit_price_usd !== 'number' || !Number.isFinite(unit_price_usd) || unit_price_usd <= 0) {
    return NextResponse.json({ error: 'unit_price_usd는 양수여야 합니다' }, { status: 400 })
  }
  if (original_price !== undefined && original_price !== null) {
    const op = Number(original_price)
    if (!Number.isFinite(op) || op < 0) {
      return NextResponse.json({ error: 'original_price는 0 이상이어야 합니다' }, { status: 400 })
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminDb = createAdminClient() as any
  const actor = auth.user.email ?? auth.user.id

  // Find or create supplier from name if supplier_id not provided
  const COLORS = ['#7c3aed','#10b981','#f59e0b','#ef4444','#7c3aed','#3b82f6','#ec4899','#14b8a6','#f97316','#84cc16']
  let finalSupplierId = (typeof supplier_id === 'string' ? supplier_id : null) || null
  if (!finalSupplierId && typeof supplier_name === 'string' && supplier_name.trim()) {
    const { data: existing } = await adminDb
      .from('suppliers')
      .select('id')
      .ilike('name', supplier_name.trim())
      .maybeSingle()
    if (existing) {
      finalSupplierId = existing.id
    } else {
      const color = COLORS[Math.floor(Math.random() * COLORS.length)]
      const { data: created } = await adminDb
        .from('suppliers')
        .insert({ name: supplier_name.trim(), color, location: null, source: 'integrated' })
        .select('id, name, country, website, description, color, logo_url')
        .single()
      finalSupplierId = created?.id ?? null
      // 회사=accounts 통합 — 통합입력 자동생성 공급사도 account 링크
      if (created?.id) { try { await ensureSupplierAccount(createAdminClient(), created, auth.user.id) } catch { /* 비치명적 */ } }
    }
  }

  // gpu_count 표준 사다리 정규화 — 비표준(x3 등)은 다음 표준단으로 올림
  const rawGpuCount = typeof body.gpu_count === 'number' ? body.gpu_count : 1
  const normalizedGpuCount = roundUpToStandard(rawGpuCount)

  const { data, error } = await adminDb
    .from('supply_quotes')
    .insert({
      product_id, supplier_id: finalSupplierId, unit_price_usd,
      gpu_count: normalizedGpuCount,
      original_currency: original_currency || null,
      original_price: (original_price != null) ? Number(original_price) : null,
      original_unit: original_unit || null,
      term: term || null,
      min_qty: min_qty || null,
      valid_until: valid_until || null,
      source_format: source_format || 'text',
      evidence_drive_file_id: evidence_drive_file_id || null,
      evidence_hash: evidence_hash || null,
      ai_confidence: ai_confidence ? Number(ai_confidence) : null,
      status: 'pending',
      received_at: new Date().toISOString(),
      registered_by: actor,
    })
    .select()
    .single()

  if (error) {
    console.error('[pricing/quotes POST]', error)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }

  await recordGpuAudit(adminDb, {
    actor,
    actionType: 'quote_registered',
    productId: product_id,
    detail: { quote_id: data.id, unit_price_usd, supplier_id: finalSupplierId },
    evidenceRef: (typeof evidence_drive_file_id === 'string' ? evidence_drive_file_id : null) ?? data.id,
  })

  // 표준 구성 사다리(×1/×2/×4/×8) 실제 적재 — 이 모델의 견적이 들어왔으니 누락 구성 보충
  try {
    const { data: prod } = await adminDb.from('gpu_products').select('model_name').eq('id', product_id).single()
    if (prod?.model_name) await ensureStandardConfigs(adminDb, prod.model_name)
  } catch { /* 비치명적 */ }

  return NextResponse.json({ quote: data })
}
