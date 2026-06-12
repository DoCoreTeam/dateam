// 변동 이력 action_type → 한글 라벨 (자기완결, 외부 import 없음 → node:test 대상)
//   기획서 변동 이력 표기와 일치(영문 코드 노출 금지).

const AUDIT_LABELS: Record<string, string> = {
  quote_registered: '견적 등록',
  quote_confirmed: '견적 확정',
  quote_updated: '견적 수정',
  quote_deleted: '견적 삭제',
  lowest_changed: '최저가 변경',
  direct_set: '판매가 직접설정',
  margin_changed: '마진 변경',
  strategic_price_set: '전략가 설정',
  expired: '만료',
  rejected: '반려',
  review_created: 'AI 분석 등록',
  review_finalized: '검토 확정',
  review_rejected: '검토 반려',
  review_recheck_completed: 'AI 재분석',
  pool_stock_changed: 'T3 재고 변경',
  availability_registered: '가용량 등록',
  inquiry_sent: '문의 발송',
  market_cost_ingested: '시장가 인입',
  market_link_synced: '가격 동기화',
}

/** 알 수 없는 코드는 원문 반환(노출 안전). */
export function auditActionLabel(actionType: string | null | undefined): string {
  if (!actionType) return '—'
  return AUDIT_LABELS[actionType] ?? actionType
}
