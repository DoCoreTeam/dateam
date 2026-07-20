# 02 — Task Breakdown (의존순 스프린트)

## Sprint 0 — 선결 (안전·추가적, 나머지의 기반)
- [ ] **T0.1** `lib/gpu/hours.ts` SSOT 신설(HOURS_PER_MONTH 등) → normalize-money.ts·observation-normalize.ts·catalog-map.ts·schema-contract.ts·market/refresh 전부 import. 720/730 단일화(채택값 문서화).
- [ ] **T0.2** 골든셋:116 번들 정답 폐기 → classify(comparable=false)와 정합. 골든 케이스를 "밴드 제외" 기대값으로 교체.
- [ ] **T0.3** market/refresh CLASSIFY_PROMPT 18·24행 "AI가 ÷730/÷장수" 지시 제거 → 코드가 산술(normalize-money 재사용). 15k 절단 제거 → fetchUrlText SSOT 사용.

## Sprint 1 — 1:N 요금성분 스키마
- [ ] **T1.1** 마이그 165 `market_price_components`(append-only, RLS owner/서비스롤, unit에 per_gb·per_account, component_kind CHECK). 기존 obs_* 하위호환 유지(NOT NULL 금지).
- [ ] **T1.2** `lib/gpu/price-components.ts` SSOT — 추출결과→components 매핑·역직렬화. 단위테스트.
- [ ] **T1.3** validate 게이트 반전: base_fee 라벨 = reject 아님 → base_fee component. NON_GPU_LABEL_FIXTURES에서 月額基本料金 제거·재분류.
- [ ] **T1.4** saveCompetitorPrices/confirm-review-item가 components 저장 경로 경유. mapping 정체성에 요금구조 축 추가(또는 component_kind로 분리).

## Sprint 2 — 결정론 추출 + reconciliation
- [ ] **T2.1** `lib/gpu/deterministic-table.ts` — 파이프표 결정론 파싱(전각 ￥ 정규화) + 라벨산문(기본료/종량/스토리지) 정규식. reconstructPivot 대체·흡수.
- [ ] **T2.2** `lib/gpu/reconciliation.ts` — 스냅샷 통화토큰 전수스캔 ↔ 추출 커버리지. 미커버 = 검수큐 강제. 완전성 배지.
- [ ] **T2.3** review/stream·market/refresh 둘 다 T2.1·T2.2 경유(활성 결선). AI는 잔여 보완만.

## Sprint 3 — 시나리오 비교 + 격리
- [ ] **T3.1** `lib/gpu/scenario-cost.ts` — 기준 시나리오(1장×730h + 스토리지) 실효비용 결정론 파생. 다부요금 합산.
- [ ] **T3.2** 콕핏/market 밴드: flat(번들) vs usage 별도 트랙, segment 격리 확정. is_latest 뷰/플래그 도입.

## Sprint 4 — 검증·회귀
- [ ] **T4.1** 소프트뱅크 스냅샷을 골든 코퍼스에 추가(5요금 전량 기대값). 회귀 고정.
- [ ] **T4.2** Playwright 실화면 검증(수동+자동 경로). package.json test 목록에 신규 테스트 추가.
