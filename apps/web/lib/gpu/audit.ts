// lib/gpu/audit.ts — GPU 감사 로그 SSOT
//
// 모든 GPU 쓰기 라우트는 이 함수를 통해 gpu_audit_logs에 기록한다.
// 직접 INSERT를 분산하지 않고 단일 진입점을 유지하여 action_type 오탈자 방지.
//
// action_type 허용값은 migrations/079_gpu_audit_action_types.sql CHECK 제약과 동기.

export type GpuActionType =
  | 'quote_registered'
  | 'quote_confirmed'
  | 'quote_supplier_assigned'
  | 'quote_edited'
  | 'quote_deleted'
  | 'lowest_changed'
  | 'expired'
  | 'direct_set'
  | 'direct_price_updated'
  | 'direct_price_deleted'
  | 'margin_changed'
  | 'rejected'
  | 'review_created'
  | 'review_finalized'
  | 'review_rejected'
  | 'review_recheck_completed'
  | 'pool_stock_changed'
  | 'pool_stock_deleted'
  | 'availability_registered'
  | 'availability_deleted'
  | 'inquiry_sent'
  | 'nonstandard_backfill'
  | 'product_created'
  | 'product_updated'
  | 'product_deleted'
  | 'market_price_updated'
  | 'market_price_deleted'

export interface RecordGpuAuditParams {
  actor: string
  actionType: GpuActionType
  productId?: string | null
  detail?: Record<string, unknown>
  evidenceRef?: string | null
}

/**
 * gpu_audit_logs에 감사 이벤트를 기록한다.
 * 비치명적 — 실패해도 호출부의 주 트랜잭션은 유지.
 *
 * @param db  service_role(adminClient) Supabase 클라이언트
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function recordGpuAudit(db: any, params: RecordGpuAuditParams): Promise<void> {
  try {
    await db.from('gpu_audit_logs').insert({
      actor: params.actor,
      action_type: params.actionType,
      product_id: params.productId ?? null,
      detail: params.detail ?? {},
      evidence_ref: params.evidenceRef ?? null,
    })
  } catch {
    // 감사 로그 실패는 비치명적 — 주 작업 흐름을 중단하지 않음
  }
}
