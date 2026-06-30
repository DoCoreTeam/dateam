import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { confirmReviewItem } from '@/lib/gpu/confirm-review-item'

// POST /api/pricing/gpu/review/[id] — 확정 또는 반려
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const supabase = await createClient()
  const user = auth.user

  const { id } = await params

  let body: {
    action?: unknown
    confirmed_items?: unknown
    rejected_reason?: unknown
    override_extracted?: unknown
    supplier_id?: unknown
    // 해소 모달에서 사용자가 매핑한 기존 카탈로그 모델 id
    product_id?: unknown
    // 일괄 확정 경로 추적 — confirmed_items(사람이 직접 확인한 필드)와 구분해 감사 정직성 유지
    bulk?: unknown
    auto_accepted_low_conf?: unknown
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }

  const action = typeof body.action === 'string' ? body.action : ''
  if (!['confirm', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'action은 confirm 또는 reject' }, { status: 400 })
  }
  // 일괄 확정 추적 — 사람검토 게이트 없이 일괄 동의로 들어온 건/자동수용 저신뢰 필드(감사 정직성)
  const isBulk = body.bulk === true
  const autoAcceptedLowConf = Array.isArray(body.auto_accepted_low_conf)
    ? (body.auto_accepted_low_conf as unknown[]).filter((v): v is string => typeof v === 'string')
    : []

  // 현재 review_item 조회
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: item, error: fetchError } = await (supabase as any)
    .from('review_items')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single()

  if (fetchError || !item) return NextResponse.json({ error: '검토 항목을 찾을 수 없습니다' }, { status: 404 })
  if (item.status !== 'pending') return NextResponse.json({ error: '이미 처리된 항목입니다' }, { status: 409 })

  const now = new Date().toISOString()
  const actorName = user.email ?? user.id
  const adminClient = createAdminClient()

  if (action === 'reject') {
    // 092 RLS: review_items 쓰기는 service_role 전용 → adminClient 사용 (user-client는 거부됨)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adminClient as any)
      .from('review_items')
      .update({
        status: 'rejected',
        confirmed_by: actorName,
        confirmed_at: now,
        rejected_reason: typeof body.rejected_reason === 'string' ? body.rejected_reason : null,
      })
      .eq('id', id)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adminClient as any)
      .from('gpu_audit_logs')
      .insert({
        actor: actorName,
        action_type: 'review_rejected',
        detail: { review_item_id: id, reason: body.rejected_reason ?? null },
      })

    return NextResponse.json({ ok: true })
  }

  // 확정 — own_target/competitor/supplier 분기 로직은 공용 SSOT(confirmReviewItem)로 위임(일괄과 동일 경로).
  const result = await confirmReviewItem(supabase, adminClient, item, actorName, {
    overrideExtracted: (body.override_extracted ?? {}) as Record<string, unknown>,
    supplierId: typeof body.supplier_id === 'string' ? body.supplier_id : null,
    productId: typeof body.product_id === 'string' ? body.product_id : null,
    confirmedItems: Array.isArray(body.confirmed_items) ? body.confirmed_items : [],
    bulk: isBulk,
    autoAcceptedLowConf,
  })
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code, candidates: result.candidates, modelName: result.modelName, gpuCount: result.gpuCount }, { status: result.status })
  const resp: Record<string, unknown> = { ok: true }
  if (result.stock) resp.stock = result.stock
  if (result.strategic) resp.strategic = result.strategic
  return NextResponse.json(resp)
}
