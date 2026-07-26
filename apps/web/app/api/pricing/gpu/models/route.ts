import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'
import { countModelImpact } from '@/lib/gpu/impact'

// 모델(base 모델 = 폼팩터·장수 구성 여러 개) 단위 일괄 삭제/복구.
//  스펙관리(SpecsTab)에서 "H100 전체"처럼 base 모델을 통째로 정리하기 위한 SSOT 진입점.
//  삭제 = 소프트삭제(deleted_at) — 물리 DELETE 아님. 연관 자식(견적·시장·재고 등)은 product_id로 남되
//  대부분 읽기 경로가 gpu_products.deleted_at IS NULL 조인 기준이라 자동 은닉되고, 복구 시 무손실로 되살아난다.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_IDS = 1000 // 배열 자원소진 방지(DC-SEC MED) — 실운영 모델 수(~100)의 10배 여유

async function parseIds(req: NextRequest): Promise<{ ids: string[]; error?: string }> {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return { ids: [], error: '요청 형식 오류' } }
  const raw = body.productIds
  if (!Array.isArray(raw) || raw.length === 0) return { ids: [], error: 'productIds(배열)가 필요합니다' }
  if (raw.length > MAX_IDS) return { ids: [], error: `productIds가 너무 많습니다(최대 ${MAX_IDS})` }
  const ids = raw.filter((v): v is string => typeof v === 'string' && UUID_RE.test(v))
  if (ids.length === 0) return { ids: [], error: '유효한 productIds가 없습니다' }
  return { ids }
}

// DELETE /api/pricing/gpu/models — body: { productIds: string[], force?: boolean }
//  연관 데이터가 있으면 409로 영향 범위를 반환(force=true로 우회 삭제).
export async function DELETE(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const force = new URL(req.url).searchParams.get('force') === 'true'

  const { ids, error: parseErr } = await parseIds(req)
  if (parseErr) return NextResponse.json({ error: parseErr }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  // 멱등: 이미 전부 소프트삭제된 id면 impact(자식은 그대로 남음) 계산으로 409 오판하지 않도록 조기 no-op.
  const { count: liveCount } = await db
    .from('gpu_products').select('id', { count: 'exact', head: true })
    .in('id', ids).is('deleted_at', null)
  if (!liveCount || liveCount === 0) {
    return NextResponse.json({ ok: true, deleted: 0 })
  }

  const impact = await countModelImpact(db, ids)
  if (impact.total > 0 && !force) {
    return NextResponse.json({
      error: `연결된 데이터 ${impact.total}건이 함께 정리됩니다. 계속하려면 강제 삭제를 확인하세요.`,
      impact: impact.detail,
    }, { status: 409 })
  }

  const { data, error } = await db
    .from('gpu_products')
    .update({ deleted_at: new Date().toISOString() })
    .in('id', ids)
    .is('deleted_at', null)
    .select('id')

  if (error) {
    console.error('[models DELETE]', error)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }

  const deletedIds: string[] = (data ?? []).map((r: { id: string }) => r.id)
  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'product_deleted',
    productId: deletedIds[0] ?? ids[0],
    detail: { scope: 'model', productIds: deletedIds, count: deletedIds.length, force, impact: impact.detail },
  })

  revalidateGpu()
  return NextResponse.json({ ok: true, deleted: deletedIds.length })
}

// PATCH /api/pricing/gpu/models — body: { productIds: string[], is_active?: boolean, needs_review?: boolean }
//  가격표 노출(취급 여부) 토글 + 검토 확정. 소프트삭제와 별개(데이터 유지, 표시만 제어).
//  검토 확정: is_active 설정 시 needs_review는 자동 false(확정으로 간주). 명시 needs_review가 우선.
export async function PATCH(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }

  const raw = body.productIds
  if (!Array.isArray(raw) || raw.length === 0) return NextResponse.json({ error: 'productIds(배열)가 필요합니다' }, { status: 400 })
  if (raw.length > MAX_IDS) return NextResponse.json({ error: `productIds가 너무 많습니다(최대 ${MAX_IDS})` }, { status: 400 })
  const ids = raw.filter((v): v is string => typeof v === 'string' && UUID_RE.test(v))
  if (ids.length === 0) return NextResponse.json({ error: '유효한 productIds가 없습니다' }, { status: 400 })

  const patch: { is_active?: boolean; needs_review?: boolean } = {}
  if (typeof body.is_active === 'boolean') {
    patch.is_active = body.is_active
    patch.needs_review = false // 노출/숨김 결정 = 검토 완료로 간주
  }
  if (typeof body.needs_review === 'boolean') patch.needs_review = body.needs_review // 명시값 우선
  if (patch.is_active === undefined && patch.needs_review === undefined) {
    return NextResponse.json({ error: 'is_active 또는 needs_review가 필요합니다' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  // 감사 before 스냅샷(DC-REV HIGH-1) — 변경 전 값을 떠 되돌리기/이력 추적 가능하게.
  const { data: beforeRows } = await db
    .from('gpu_products')
    .select('id, is_active, needs_review')
    .in('id', ids)
    .is('deleted_at', null)
  const before: Record<string, { is_active: boolean; needs_review: boolean }> = {}
  for (const r of (beforeRows ?? []) as Array<{ id: string; is_active: boolean; needs_review: boolean }>) {
    before[r.id] = { is_active: r.is_active, needs_review: r.needs_review }
  }

  const { data, error } = await db
    .from('gpu_products')
    .update(patch)
    .in('id', ids)
    .is('deleted_at', null)
    .select('id')

  if (error) {
    console.error('[models PATCH visibility]', error)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }

  const changedIds: string[] = (data ?? []).map((r: { id: string }) => r.id)
  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'product_visibility_changed',
    productId: changedIds[0] ?? ids[0],
    detail: {
      scope: 'model', productIds: changedIds, count: changedIds.length,
      after: patch,
      before: changedIds.map((id) => ({ id, ...(before[id] ?? {}) })),
    },
  })

  revalidateGpu()
  return NextResponse.json({ ok: true, changed: changedIds.length })
}

// POST /api/pricing/gpu/models — body: { productIds: string[] }  — 소프트삭제 모델 되돌리기(복구)
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const { ids, error: parseErr } = await parseIds(req)
  if (parseErr) return NextResponse.json({ error: parseErr }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  const { data, error } = await db
    .from('gpu_products')
    .update({ deleted_at: null })
    .in('id', ids)
    .not('deleted_at', 'is', null)
    .select('id')

  if (error) {
    console.error('[models POST restore]', error)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }

  const restoredIds: string[] = (data ?? []).map((r: { id: string }) => r.id)
  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'product_restored',
    productId: restoredIds[0] ?? ids[0],
    detail: { scope: 'model', productIds: restoredIds, count: restoredIds.length },
  })

  revalidateGpu()
  return NextResponse.json({ ok: true, restored: restoredIds.length })
}
