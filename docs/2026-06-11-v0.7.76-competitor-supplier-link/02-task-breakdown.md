# 02 Task Breakdown (.ralph/fix_plan.md 동기화)
P1 데이터: 083 supplier_id FK + supply_quotes 출처/추적 + audit type
P2 백엔드: 연결 PATCH + 승인 인입 POST(스냅샷·audit·revalidate) + 응답 연계메타 + 공개API 비노출
P3 프론트: MarketTab 연결+인입 UI / SuppliersTab 배지 / cockpit 연계원가 출처 배지
P4 검증: tsc/design/test + 브라우저 E2E + DC-QA/SEC/REV + 버전·commit
의존: P1→P2→P3→P4. 단일 루프.
