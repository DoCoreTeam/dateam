# FAST PATH Summary
작업: GPU AI 추출 결과 quantity 필드 표시 수정 — boolean/객체/재고상태 전용 렌더링
대상: apps/web/app/(member)/pricing/gpu/tabs/QuoteRegisterTab.tsx
이유: quantity가 JSON 덩어리로, has_quantity_info가 true/false 원문으로, 알 수 없는 키가 raw 영문으로 표시됨
영향: 없음 (표시 로직만)

## 변경 사항
1. CONF_LABELS 확장: original_price/currency/unit, tier_reason, has_quantity_info, quantity 추가
2. QTY_STATUS_LABELS 추가: available_full→재고 있음, available_partial→일부 가능, out_of_stock→재고 없음, declined→공급 거절, pending→확인 중
3. formatExtractedValue() 함수 추출:
   - null/undefined → "—"
   - boolean → "있음"/"없음"
   - quantity 객체 → "재고 있음 · 8개" 형태로 압축
   - 기타 객체 → JSON.stringify 80자 truncate
4. 루프 인라인 변환 → formatExtractedValue() 호출로 교체
