import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { getGpuCatalog } from '@/lib/gpu/pricing'
import { roundUpToStandard } from '@/lib/gpu/config-ladder'
import { ensureStandardConfigs } from '@/lib/gpu/derive-configs'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'

// GET /api/pricing/gpu/products — 가격표/고객판매가 공용 (L2 SSOT 경유)
export async function GET() {
  try {
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    const catalog = await getGpuCatalog(db)

    // pending count per product (소프트삭제 제외)
    const pendingRes = await db
      .from('supply_quotes')
      .select('product_id')
      .eq('status', 'pending')
      .is('deleted_at', null)

    const pendingCountMap = new Map<string, number>()
    for (const row of pendingRes.data ?? []) {
      const pid = row.product_id as string
      pendingCountMap.set(pid, (pendingCountMap.get(pid) ?? 0) + 1)
    }

    // effective(1장당 전파)를 legacy 필드명에 매핑 → 기존 UI 호환 + 메뉴 정합
    const products = catalog.products.map((p) => ({
      id: p.id,
      model_name: p.model_name,
      memory: p.memory,
      tier: p.tier,
      pricing_mode: p.pricing_mode,
      gpu_count: p.gpu_count,
      vcpu: p.vcpu,
      ram_gb: p.ram_gb,
      storage_gb: p.storage_gb,
      series: p.series,
      // legacy 호환 (effective = 1장당 전파 반영값)
      lowest_unit_price_usd: p.effective_unit_price_usd,
      lowest_supplier: p.effective_supplier,
      lowest_valid_until: p.own_valid_until,
      sell_price_krw: p.sell_price_krw,
      sell_price_usd: p.sell_price_usd,
      // 신규 SSOT 필드
      per_gpu_usd: p.per_gpu_usd,
      effective_unit_price_usd: p.effective_unit_price_usd,
      effective_supplier: p.effective_supplier,
      is_propagated: p.is_propagated,
      own_lowest_usd: p.own_lowest_usd,
      own_supplier: p.own_supplier,
      // 기준 공급가 채택 상태
      basis: p.basis,
      selected_supplier: p.selected_supplier,
      fallback_reason: p.fallback_reason,
      pending_count: pendingCountMap.get(p.id) ?? 0,
    }))

    return NextResponse.json({
      products,
      margin_pct: catalog.margin_pct,
      usd_krw: catalog.usd_krw,
      fx_date: catalog.fx_date,
    })
  } catch (err) {
    console.error('[pricing/products]', err)
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 })
  }
}

// POST /api/pricing/gpu/products — GPU 구성(gpu_products) 신규 생성
// 생성 후 ensureStandardConfigs로 표준 사다리 나머지 구성 자동 보충.
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }

  const modelName = typeof body.model_name === 'string' ? body.model_name.trim() : ''
  if (!modelName) return NextResponse.json({ error: 'model_name 필수' }, { status: 400 })

  const rawGpuCount = typeof body.gpu_count === 'number' ? body.gpu_count : 1
  const gpuCount = roundUpToStandard(rawGpuCount)

  const tier = Number(body.tier ?? 1)
  if (![1, 2, 3].includes(tier)) {
    return NextResponse.json({ error: 'tier는 1·2·3만 가능합니다' }, { status: 400 })
  }

  const pricingMode = body.pricing_mode === 'direct' ? 'direct' : 'quote'
  const series = typeof body.series === 'string' ? (body.series.trim() || null) : null
  const memory = typeof body.memory === 'string' ? (body.memory.trim() || null) : null
  const vcpuRaw = body.vcpu != null ? Number(body.vcpu) : null
  if (vcpuRaw !== null && (!Number.isFinite(vcpuRaw) || vcpuRaw <= 0)) {
    return NextResponse.json({ error: 'vcpu는 양수여야 합니다' }, { status: 400 })
  }
  const vcpu = vcpuRaw

  const ramRaw = body.ram_gb != null ? Number(body.ram_gb) : null
  if (ramRaw !== null && (!Number.isFinite(ramRaw) || ramRaw <= 0)) {
    return NextResponse.json({ error: 'ram_gb는 양수여야 합니다' }, { status: 400 })
  }
  const ramGb = ramRaw

  const storageRaw = body.storage_gb != null ? Number(body.storage_gb) : null
  if (storageRaw !== null && (!Number.isFinite(storageRaw) || storageRaw <= 0)) {
    return NextResponse.json({ error: 'storage_gb는 양수여야 합니다' }, { status: 400 })
  }
  const storageGb = storageRaw

  const db = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminDb = db as any

  // UNIQUE 충돌 사전 확인 (model_name + memory + gpu_count + vcpu + tier)
  const { data: existing } = await adminDb
    .from('gpu_products')
    .select('id')
    .eq('model_name', modelName)
    .eq('gpu_count', gpuCount)
    .eq('tier', tier)
    .is('deleted_at', null)
    .limit(1)
  if (existing && existing.length > 0) {
    return NextResponse.json({ error: '동일한 구성(모델/장수/Tier)이 이미 존재합니다' }, { status: 409 })
  }

  const { data, error } = await adminDb
    .from('gpu_products')
    .insert({
      model_name: modelName,
      gpu_count: gpuCount,
      tier,
      pricing_mode: pricingMode,
      series,
      memory,
      vcpu,
      ram_gb: ramGb,
      storage_gb: storageGb,
    })
    .select()
    .single()

  if (error) {
    console.error('[products POST]', error)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }

  await recordGpuAudit(adminDb, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'product_created',
    productId: data.id,
    detail: { model_name: modelName, gpu_count: gpuCount, tier, pricing_mode: pricingMode },
  })

  // 표준 사다리 누락 구성 자동 보충
  try { await ensureStandardConfigs(adminDb, modelName) } catch { /* 비치명적 */ }

  revalidateGpu()
  return NextResponse.json({ product: data }, { status: 201 })
}
