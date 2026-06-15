# 04 완료 기준 (라인별 체크 — GATE 2)

## 기능
- [ ] C1 xlsx 업로드(서버 파싱) 동작 — 실 184행 파일 headers 12개·rows 184 인식
- [ ] C2 AI 헤더매핑 1회 호출 → mapping JSON 반환(competitor_name/model_name/price_usd/memory/pricing_model + _unit/_currency)
- [ ] C3 코드가 전체 184행 결정적 변환 → CompetitorPriceItem[] (location split·숫자화·spot 매핑)
- [ ] C4 dedup + validate 통과분만 review_items 적재(target=competitor, channel=catalog, is_test)
- [ ] C5 검토대기 승인(confirm) → competitors + market_prices 반영
- [ ] C6 미준비 형식 → AI 매핑 프롬프트 자가합성 후 재시도(거버넌스 경유)

## Feature Defaults (신규 엔티티 review_items.target — CRUD 관점)
- [ ] C7 적재(Create) + 검토대기 목록 조회(Read/List) + 승인/반려(Update: confirmed/rejected) 동작
- [ ] C8 행수준 권한: requireAdminApi(쓰기 service_role) — 비관리자 차단
- [ ] C9 is_test 격리(테스트행 분리) + revert로 운영 오염 0

## 비기능/품질
- [ ] C10 SSOT 재사용(dedup/validate/tier-dict/normalize/saveCompetitorPrices/extract-helpers) — 복붙 0
- [ ] C11 기존 supplier 경로 무수정 — 회귀 0 (review/stream·기존 confirm supplier 분기 동작)
- [ ] C12 보안: 파일 크기/시트 제한, 수식인젝션 sanitize, 매핑 필드 화이트리스트, AI 반환 검증, 업로드 admin-only
- [ ] C13 디자인 표준: input-field/label/공용버튼, design:check 통과
- [ ] C14 단위테스트 PASS + package.json test 목록 등록, tsc·lint 0
- [ ] C15 Playwright 실 xlsx E2E(업로드→검토대기→승인→market_prices) 통과

## 게이트
- [ ] C16 DC-QA(CRITICAL/HIGH 0) · DC-SEC 통과 · DC-REV ≥80
- [ ] C17 GATE 1-5 + 버전 v0.7.115 4파일 동기화 + commit(push 금지)
