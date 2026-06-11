import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// PUT /api/pricing/gpu/suppliers/[id]/model-tier
//   공급사+모델별 Tier override 설정/해제 (라벨 전용 — 가격 무관).
//   body { model_name: string, tier: 1|2|3 }  → upsert
//   body { model_name: string, tier: null }   → 해제(자동 tier로 복귀)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: '공급사 ID 형식 오류' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }

  const modelName = typeof body.model_name === 'string' ? body.model_name.trim() : ''
  if (!modelName) {
    return NextResponse.json({ error: 'model_name 필수' }, { status: 400 })
  }

  // tier: null(해제) 또는 1|2|3
  const rawTier = body.tier
  const tier: number | null = rawTier === null ? null : Number(rawTier)
  if (tier !== null && ![1, 2, 3].includes(tier)) {
    return NextResponse.json({ error: 'tier는 1/2/3 또는 null이어야 합니다' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  // 공급사 실재 확인
  const { data: sup, error: supErr } = await db
    .from('suppliers').select('id, name').eq('id', id).maybeSingle()
  if (supErr) {
    console.error('[supplier model-tier] supplier lookup', supErr)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }
  if (!sup) return NextResponse.json({ error: '공급사를 찾을 수 없습니다' }, { status: 404 })

  if (tier === null) {
    // 해제 — override 삭제
    const { error } = await db
      .from('supplier_model_tier')
      .delete()
      .eq('supplier_id', id)
      .eq('model_name', modelName)
    if (error) {
      console.error('[supplier model-tier] delete', error)
      return NextResponse.json({ error: '해제 실패' }, { status: 500 })
    }
  } else {
    // upsert — (supplier_id, model_name) UNIQUE
    const { error } = await db
      .from('supplier_model_tier')
      .upsert(
        { supplier_id: id, model_name: modelName, tier, updated_at: new Date().toISOString() },
        { onConflict: 'supplier_id,model_name' },
      )
    if (error) {
      console.error('[supplier model-tier] upsert', error)
      return NextResponse.json({ error: '설정 실패' }, { status: 500 })
    }
  }

  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'market_price_updated',
    detail: {
      op: 'supplier_model_tier_set',
      supplier_id: id,
      supplier_name: sup.name,
      model_name: modelName,
      tier,
    },
  })

  revalidateGpu()
  return NextResponse.json({ ok: true, supplier_id: id, model_name: modelName, tier })
}
