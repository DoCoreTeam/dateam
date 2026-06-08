# 02 Task Breakdown

Sprint A~D + 검증. 상세 체크리스트는 .ralph/fix_plan.md 와 동기화.

## Sprint A — 데이터 정합 기반
- A1 lib/gpu/config-ladder.ts (SSOT 상수+헬퍼)
- A2 ensureStandardConfigs를 config-ladder 기반 1장환산으로 통일
- A3 review/[id] confirm 경로 정규화+ensureStandardConfigs 호출
- A4 마이그레이션: 비표준 진단/quarantine/표준단 백필
- A5 입력단 정규화 일원화(quotes POST + review)

## Sprint B — SSOT cascade
- B1 settings PATCH·fx POST revalidateGpu 추가
- B2 swr-keys prefixes에 settings·fx
- B3 lib/gpu/audit.ts + 쓰기 경로 audit
- B4 lib/gpu/impact.ts 영향 프리뷰

## Sprint C — CRUD API
- C1 gpu_products POST/PATCH 확장
- C2 supply_quotes/direct_prices 소프트삭제+참조검사
- C3 market/prices PATCH + direct-prices GET
- C4 availability/pool-stock CRUD 보강
- C5 신설 route 공통(admin+audit+revalidate+정규화)

## Sprint D — CRUD UI
- D1 가격표 인라인 편집/삭제+프리뷰
- D2 상품 직접 등록
- D3 시장비교 경쟁가 수정/삭제
- D4 재고 편집/삭제 보강
- D5 고객판매가 마진/할인 일관
- D6 반응형·토큰·테이블카드 검증

## Phase E — 검증
- E1 typecheck/design:check/단위
- E2 브라우저 E2E
- E3 DC-QA/SEC/REV
- E4 버전·docs·commit

## 빌드 순서/의존성
A(정합) → B(cascade·audit 기반) → C(API, B의 audit/impact 사용) → D(UI, C API 소비) → E.
A는 C/D의 정규화 SSOT를 제공하므로 선행 필수.
