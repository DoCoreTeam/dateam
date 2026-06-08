import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'

const FIELDS = ['competitor_sku', 'competitor_url', 'pricing_model', 'region', 'is_active'] as const

// PATCH /api/pricing/gpu/market/mappings/[id] — 경쟁사-제품 매핑 수정
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }
  const patch: Record<string, unknown> = {}
  for (const k of FIELDS) if (k in body) patch[k] = body[k] === '' ? null : body[k]
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '변경 필드 없음' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const { data, error } = await db.from('competitor_product_mapping').update(patch).eq('id', id).select().single()
  if (error) {
    console.error('[market/mappings/[id] PATCH]', error)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }

  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'market_price_updated',
    detail: { mapping_id: id, patch },
  })

  revalidateGpu()
  return NextResponse.json({ mapping: data })
}

// DELETE /api/pricing/gpu/market/mappings/[id] — 매핑 삭제(연결 시세도 함께 제거)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  // 자식 시세 소프트삭제 (market_prices는 deleted_at 컬럼 있음)
  await db.from('market_prices').update({ deleted_at: new Date().toISOString() }).eq('mapping_id', id).is('deleted_at', null)
  // 매핑 삭제 (competitor_product_mapping은 deleted_at 미적용 — 하드 delete 유지)
  const { error } = await db.from('competitor_product_mapping').delete().eq('id', id)
  if (error) {
    console.error('[market/mappings/[id] DELETE]', error)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }

  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'market_price_deleted',
    detail: { mapping_id: id },
  })

  revalidateGpu()
  return NextResponse.json({ ok: true })
}
