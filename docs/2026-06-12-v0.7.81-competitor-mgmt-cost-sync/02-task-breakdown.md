# 02 작업 분해 (v0.7.81)
P1 용어 SSOT: lib/gpu/terms.ts.
P2 경쟁사 탭: 마이그087(deleted_at) → api/competitors(GET/POST/[id]PATCH·DELETE/bulk-delete/bulk-promote) → CompetitorsTab.tsx + 탭 등록 + 용어 적용.
P3 동기화: lib/gpu/market-refresh.ts 공용화 → "동기화" 버튼 → pending 견적 생성(값변경시) → 검토대기 승인 연계 → 실견적 우선 필터(repository) + 출처배지. MarketTab "원가 인입" 제거.
P4 tsc/design/test, Playwright(원복), DC-QA/SEC/REV, 버전·commit.
