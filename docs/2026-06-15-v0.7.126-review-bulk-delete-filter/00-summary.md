# 00 요약 — 검토대기 일괄 삭제 + 공급사/경쟁사 필터 (MEDIUM)

## 작업
검토 대기(review_items)에 일괄 작업·필터가 없어 카탈로그 대량 적재분(테스트/경쟁사) 정리가 불가능했던 문제 해결.
- **일괄 삭제(영구 제거)** — 선택 체크박스 + 전체 선택 + 일괄 삭제 버튼(확인 다이얼로그).
- **필터(전체/공급사/경쟁사)** — target 기준. 공급사 견적과 경쟁사 카탈로그가 한 큐에 섞이던 문제 해소.

## 수정 파일
- `app/api/pricing/gpu/review/bulk/route.ts` (신규) — POST {ids, action:'delete'}. requireAdminApi, review_items 영구 삭제(review_iterations FK CASCADE), 감사로그. 최대 500건/회. 가격DB(market_prices) 무영향.
- `app/api/pricing/gpu/review/route.ts` — GET 목록 한도 50→200 (대량 적재분 한 화면 선택·삭제 가능).
- `app/(member)/pricing/gpu/tabs/ReviewTab.tsx` — 필터 버튼(전체/공급사/경쟁사 + 건수), 카드별 선택 체크박스, 전체선택, 선택 N건 + 일괄 삭제 바.

## 이유
- 사용자 규칙 "일괄 적용 했다면 일괄 삭제도 가능 = CRUD 핵심". 카탈로그 흡수(v0.7.118)가 127건을 한 번에 적재하는데 개별 삭제만 가능해 사용 불가.
- 일괄 삭제 의미 = 영구 제거(사용자 확정). 일괄 반려/확정은 이번 범위 제외(사용자 선택).

## 영향 범위
- review_items 삭제는 pending 검토대기 행만 — 확정된 시세/원가(market_prices/supply_quotes) 무영향.
- 기존 개별 확정/반려/재분석 흐름 무수정. 공급사 경로 회귀 0.
- 권한: 삭제는 requireAdminApi(service_role) 전용.
