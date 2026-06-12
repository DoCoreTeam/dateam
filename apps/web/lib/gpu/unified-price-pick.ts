// 통합 표 — 판매가/마진 선택 규칙(자기완결, 외부 import 없음 → node:test 대상)
//
// 어댑터(cockpit-to-unified)가 사용하는 순수 결정 로직만 분리:
//   - 전략가가 설정되면 판매가=전략가(둘 중 있는 값), 마진=실효마진
//   - 아니면 판매가=판매가 후보(자동 마진가), 마진=설정 마진
// 계산하지 않는다(값 선택만). DC-QA #2(전략가 set인데 값 null) 분기를 명시 커버.

export interface SellPriceInput {
  is_strategic_set: boolean
  strategic_krw: number | null
  strategic_price_krw: number | null
  candidate_price_krw: number | null
}

/** 판매가 선택. 전략가 set이면 strategic_krw ?? strategic_price_krw, 아니면 판매가 후보. 모두 null이면 null. */
export function pickSellPrice(p: SellPriceInput): number | null {
  if (p.is_strategic_set) return p.strategic_krw ?? p.strategic_price_krw ?? null
  return p.candidate_price_krw ?? null
}

export interface MarginInput {
  is_strategic_set: boolean
  effective_margin_pct: number | null
  margin_pct: number
}

/** 마진 선택. 전략가 set이면 실효마진(null 가능 → 측정불가), 아니면 설정 마진. */
export function pickMargin(p: MarginInput): number | null {
  return p.is_strategic_set ? p.effective_margin_pct : p.margin_pct
}
