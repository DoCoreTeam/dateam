import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { confirmReviewItem } from '@/lib/gpu/confirm-review-item'
import { CONFIDENCE_AUTO_MIN } from '@/lib/gpu/confidence-gate'
import type { VariantCandidate } from '@/lib/gpu/resolve-product'

// POST /api/pricing/gpu/review/bulk — 검토대기 항목 일괄 처리.
//  body: { ids: string[], action: 'delete' | 'confirm', auto_accepted_low_conf?: Record<id, string[]> }
//  권한: 라이브 반영(confirm=가격표 확정)·검토대기 일괄 삭제 모두 admin 전용(확정/마스터 경계 SSOT).
//  delete  = review_items 소프트삭제(deleted_at)(가격DB 무영향, pending 정리용).
//  confirm = 선택 항목을 가격표에 일괄 확정(공용 confirmReviewItem SSOT).
const MAX_BULK = 500

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const user = auth.user

  let body: { ids?: unknown; action?: unknown; auto_accepted_low_conf?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }

  let ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is string => typeof v === 'string' && v.length > 0).slice(0, MAX_BULK)
    : []
  const action = typeof body.action === 'string' ? body.action : ''
  if (!['delete', 'confirm', 'auto_confirm'].includes(action)) {
    return NextResponse.json({ error: 'action은 delete·confirm·auto_confirm' }, { status: 400 })
  }
  // auto_confirm 은 ids 를 받지 않고, 서버가 "AI 확신(신뢰도 높음)" 대기 항목을 직접 골라 확정한다.
  //   (설계 헌법 제4조 — AI가 채우고 사람은 확인만. 관리자 전용·감사기록·되돌리기 그대로 = 안전.)
  if (action !== 'auto_confirm' && ids.length === 0) {
    return NextResponse.json({ error: '선택된 항목이 없습니다' }, { status: 400 })
  }

  const adminClient = createAdminClient()
  const actorName = user.email ?? user.id

  if (action === 'auto_confirm') {
    // 신뢰도 ≥ 자동확정 임계(보수적) & 실데이터(테스트 제외) & 미처리(pending) 만 선별.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: hi } = await (adminClient as any)
      .from('review_items')
      .select('id')
      .eq('status', 'pending').is('deleted_at', null).eq('is_test', false)
      .gte('overall_confidence', CONFIDENCE_AUTO_MIN)
      .limit(MAX_BULK)
    ids = ((hi ?? []) as Array<{ id: string }>).map((r) => r.id)
    if (ids.length === 0) return NextResponse.json({ ok: true, confirmed: 0, failed: [], message: 'AI가 확신하는 대기 항목이 없어요' })
  }

  // ── 일괄 삭제 ──────────────────────────────────────────
  if (action === 'delete') {
    // 소프트삭제 — 하드 delete 대신 deleted_at 마킹(오삭제 복구·감사 보존). 이미 삭제된 행은 제외.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (adminClient as any)
      .from('review_items').update({ deleted_at: new Date().toISOString() }).in('id', ids).is('deleted_at', null).select('id')
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
  // 실패 항목 — 단건 확정이 반환하는 인카드 조치 컨텍스트(candidates·modelName·gpuCount)를 그대로 실어
  //  보낸다. 이게 없으면 클라가 일괄 실패 카드에서 '메모리 변형 선택' 버튼을 못 띄운다(단건과 비대칭).
  const failed: Array<{
    id: string
    hint: string | null
    error: string
    code: string | null
    candidates?: VariantCandidate[]
    modelName?: string
    gpuCount?: number
  }> = []

  // 순차 처리 — 각 항목이 product/supplier 자동생성·멱등 superseded를 포함하므로 동시성 충돌 방지 위해 직렬.
  for (const id of ids) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: item } = await (supabase as any).from('review_items').select('*').eq('id', id).is('deleted_at', null).single()
      if (!item) { failed.push({ id, hint: null, error: '항목을 찾을 수 없음', code: null }); continue }
      if (item.status !== 'pending') { failed.push({ id, hint: item.product_hint ?? null, error: '이미 처리됨', code: null }); continue }
      const auto = Array.isArray(autoMap[id]) ? (autoMap[id] as unknown[]).filter((v): v is string => typeof v === 'string') : []
      const result = await confirmReviewItem(supabase, adminClient, item, actorName, {
        confirmedItems: [],
        bulk: true,
        autoAcceptedLowConf: auto,
      })
      if (result.ok) confirmed++
      // 실패 항목에 보류 사유 code + 인카드 조치 컨텍스트 동봉 → 클라가 개별 카드에서 단건과 동일하게 조치.
      else failed.push({
        id,
        hint: item.product_hint ?? null,
        error: result.error ?? '확정 실패',
        code: result.code ?? null,
        candidates: result.candidates,
        modelName: result.modelName,
        gpuCount: result.gpuCount,
      })
    } catch (e) {
      failed.push({ id, hint: null, error: e instanceof Error ? e.message : '확정 예외', code: null })
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
