import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { confirmReviewItem } from '@/lib/gpu/confirm-review-item'

// POST /api/pricing/gpu/review/bulk — 검토대기 항목 일괄 처리.
//  body: { ids: string[], action: 'delete' | 'confirm', auto_accepted_low_conf?: Record<id, string[]> }
//  권한: 라이브 반영(confirm=가격표 확정)·검토대기 일괄 삭제 모두 admin 전용(확정/마스터 경계 SSOT).
//  delete  = review_items 영구 삭제(가격DB 무영향, pending 정리용).
//  confirm = 선택 항목을 가격표에 일괄 확정(공용 confirmReviewItem SSOT).
const MAX_BULK = 500

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const user = auth.user

  let body: { ids?: unknown; action?: unknown; auto_accepted_low_conf?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is string => typeof v === 'string' && v.length > 0).slice(0, MAX_BULK)
    : []
  const action = typeof body.action === 'string' ? body.action : ''
  if (ids.length === 0) return NextResponse.json({ error: '선택된 항목이 없습니다' }, { status: 400 })
  if (!['delete', 'confirm'].includes(action)) {
    return NextResponse.json({ error: 'action은 delete 또는 confirm' }, { status: 400 })
  }

  const adminClient = createAdminClient()
  const actorName = user.email ?? user.id

  // ── 일괄 삭제 ──────────────────────────────────────────
  if (action === 'delete') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (adminClient as any)
      .from('review_items').delete().in('id', ids).select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const deleted = (data ?? []) as Array<{ id: string }>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adminClient as any).from('gpu_audit_logs').insert({
      actor: actorName,
      action_type: 'review_bulk_deleted',
      detail: { count: deleted.length, requested: ids.length },
    }).then(undefined, () => {})
    return NextResponse.json({ ok: true, deleted: deleted.length })
  }

  // ── 일괄 확정 ──────────────────────────────────────────
  // 항목별 자동수용 저신뢰 필드(감사) — { [reviewItemId]: string[] }
  const autoMap = (body.auto_accepted_low_conf && typeof body.auto_accepted_low_conf === 'object')
    ? body.auto_accepted_low_conf as Record<string, unknown>
    : {}

  const supabase = await createClient()
  let confirmed = 0
  const failed: Array<{ id: string; hint: string | null; error: string }> = []

  // 순차 처리 — 각 항목이 product/supplier 자동생성·멱등 superseded를 포함하므로 동시성 충돌 방지 위해 직렬.
  for (const id of ids) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: item } = await (supabase as any).from('review_items').select('*').eq('id', id).single()
      if (!item) { failed.push({ id, hint: null, error: '항목을 찾을 수 없음' }); continue }
      if (item.status !== 'pending') { failed.push({ id, hint: item.product_hint ?? null, error: '이미 처리됨' }); continue }
      const auto = Array.isArray(autoMap[id]) ? (autoMap[id] as unknown[]).filter((v): v is string => typeof v === 'string') : []
      const result = await confirmReviewItem(supabase, adminClient, item, actorName, {
        confirmedItems: [],
        bulk: true,
        autoAcceptedLowConf: auto,
      })
      if (result.ok) confirmed++
      else failed.push({ id, hint: item.product_hint ?? null, error: result.error ?? '확정 실패' })
    } catch (e) {
      failed.push({ id, hint: null, error: e instanceof Error ? e.message : '확정 예외' })
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (adminClient as any).from('gpu_audit_logs').insert({
    actor: actorName,
    action_type: 'review_bulk_confirmed',
    detail: { confirmed, failed: failed.length, requested: ids.length, via: 'bulk' },
  }).then(undefined, () => {})

  return NextResponse.json({ ok: true, confirmed, failed })
}
