import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'
import { countImpact } from '@/lib/gpu/impact'

// PATCH /api/pricing/gpu/products/[id] — 구성(gpu_products)의 인스턴스 스펙 + 기본 필드 수정
//  가격표·시장비교·재고·고객판매가격표 4탭이 공통으로 표시하는 스펙(VRAM/vCPU/RAM/SSD)의 단일 편집 지점.
const SPEC_FIELDS = ['memory', 'vcpu', 'ram_gb', 'storage_gb', 'series'] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }

  const patch: Record<string, unknown> = {}
  for (const k of SPEC_FIELDS) {
    if (!(k in body)) continue
    const v = body[k]
    if (k === 'memory' || k === 'series') patch[k] = (typeof v === 'string' && v.trim()) ? v.trim() : null
    else {
      if (v === '' || v === null) { patch[k] = null }
      else {
        const n = Number(v)
        if (!Number.isFinite(n) || n <= 0) return NextResponse.json({ error: `${k}는 양수여야 합니다` }, { status: 400 })
        patch[k] = n
      }
    }
  }

  // model_name 수정
  if ('model_name' in body) {
    const v = typeof body.model_name === 'string' ? body.model_name.trim() : ''
    if (!v) return NextResponse.json({ error: 'model_name은 비울 수 없습니다' }, { status: 400 })
    patch.model_name = v
  }
  // pricing_mode 수정 (quote / direct)
  if ('pricing_mode' in body) {
    if (body.pricing_mode !== 'quote' && body.pricing_mode !== 'direct') {
      return NextResponse.json({ error: 'pricing_mode는 quote 또는 direct만 가능합니다' }, { status: 400 })
    }
    patch.pricing_mode = body.pricing_mode
  }
  // tier 수동 변경 (1/2/3)
  if ('tier' in body) {
    const t = Number(body.tier)
    if (![1, 2, 3].includes(t)) return NextResponse.json({ error: 'tier는 1·2·3만 가능합니다' }, { status: 400 })
    patch.tier = t
  }
  // 필수 필드 null 방지
  if ('vcpu' in patch && patch.vcpu == null) return NextResponse.json({ error: 'vCPU는 비울 수 없습니다' }, { status: 400 })
  if ('ram_gb' in patch && patch.ram_gb == null) return NextResponse.json({ error: 'RAM은 비울 수 없습니다' }, { status: 400 })
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '변경할 필드가 없습니다' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  // tier 변경 시 중복 충돌 가드
  if ('tier' in patch) {
    const { data: cur } = await db.from('gpu_products').select('model_name, memory, gpu_count, vcpu').eq('id', id).single()
    if (cur) {
      const { data: clash } = await db.from('gpu_products').select('id')
        .eq('model_name', cur.model_name).eq('memory', cur.memory)
        .eq('gpu_count', cur.gpu_count).eq('vcpu', cur.vcpu).eq('tier', patch.tier)
        .neq('id', id).is('deleted_at', null).limit(1)
      if (clash && clash.length > 0) return NextResponse.json({ error: '같은 구성이 해당 Tier에 이미 존재합니다' }, { status: 409 })
    }
  }

  const { data, error } = await db.from('gpu_products').update(patch).eq('id', id).is('deleted_at', null).select().single()
  if (error) {
    console.error('[products/[id] PATCH]', error)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 })

  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'product_updated',
    productId: id,
    detail: { patch },
  })

  revalidateGpu()
  return NextResponse.json({ product: data })
}

// DELETE /api/pricing/gpu/products/[id] — 구성 소프트삭제
//  참조 건수가 있으면 차단 (?force=true 로 우회 가능 — 참조 있어도 삭제)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params
  const force = new URL(req.url).searchParams.get('force') === 'true'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  const impact = await countImpact(db, 'gpu_product', id)
  if (impact.total > 0 && !force) {
    return NextResponse.json({
      error: `연결된 데이터 ${impact.total}건이 있습니다. ?force=true를 사용하면 강제 삭제됩니다.`,
      impact: impact.detail,
    }, { status: 409 })
  }

  const { error } = await db
    .from('gpu_products')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)

  if (error) {
    console.error('[products/[id] DELETE]', error)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }

  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'product_deleted',
    productId: id,
    detail: { force, impact: impact.detail },
  })

  revalidateGpu()
  return NextResponse.json({ ok: true })
}
