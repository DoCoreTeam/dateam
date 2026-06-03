# 정합성 "무조건 틀어질 수 없게" — 강제 아키텍처 (분석 전용)

> 상태: **분석 전용 — 구현 금지** · 2026-06-03 · 코드 + psql 실측
> 핵심 요구: 대량 입력·사람이 다 확인 불가 → 정합성은 **규율이 아니라 시스템 구조로 강제**. 어디를 고쳐도 동시 반영, 절대 어긋날 수 없게.

## 결론 (한 줄)
현재 정합성은 **흩어진 앱 코드 규율에만 의존**(쓰기 6/3/5갈래, **DB 트리거 0·생성컬럼 0**). → "한 곳 수정 시 나머지 미반영" 위험이 구조적으로 존재. **단일 쓰기 서비스 + 단일 읽기 + DB 불변식 + 원자적 캐시 무효화 + CI 정합성 테스트**의 5중 방어로 "무조건 틀어질 수 없게" 만든다.

## 1. 현 위험 (실측)
### 쓰기 경로 분산 (한 곳 고쳐도 나머지 안 따라옴)
| 테이블 | 쓰기 경로 수 | 경로 |
|--------|------|------|
| supply_quotes | **6** | suppliers, public/suppliers, quotes POST, quotes/reject, quotes/confirm, review/[id] |
| market_prices | **3** | review, market/prices, market/refresh |
| gpu_products(자동생성) | **3** | review, review/[id], market/refresh |
| suppliers(find-or-create) | **5** | review/[id], quotes, availability, suppliers×2 |
| competitor_mapping | 2 | review, market/refresh |
- 각 경로가 per-card 환산·tier 추론·memory 정규화·dedup·supplier 가드를 **제각각 재구현** → 한 곳만 고치면 불일치.

### DB 레벨 보증 전무
- **트리거 0, 생성컬럼 0.** 모든 불변식이 앱 코드에만 존재(예: 공급사 필수 가드는 confirm 라우트에만).
- `gpu_products` 유니크 = `(model_name, memory, gpu_count, vcpu, tier)` → **vcpu가 다르면 같은 모델도 별도 행** = 중복 상품 누수 → 가격/표시 분리.
- → 대량/직접 입력 시 앱 가드를 우회하면 즉시 정합성 붕괴.

## 2. 강제 아키텍처 — 5중 방어 (defense in depth)

### L1. 단일 쓰기 서비스 (앱) — 모든 변경의 유일 통로
- `lib/gpu/repository.ts` 에 **유일한 변경 함수**: `upsertSupplyQuote()` · `upsertMarketPrice()` · `findOrCreateProduct()` · `findOrCreateSupplier()` · `recordAvailability()` · `removeStock()`.
- 모든 API 라우트는 이 함수만 호출. **라우트에서 raw `.insert/.update/.delete` 금지.**
- per-card 환산·총액 표준·dedup·supplier 가드·supersede를 **한 곳에 집약** → 한 번 고치면 6경로 전부 반영.

### L2. 단일 읽기 (파생 SSOT) — 03 문서 util
- `lib/gpu/pricing.ts` `getGpuCatalog()` 하나로 effective price/supplier 산출. 모든 메뉴 라우트가 이것만 read. 재조인 금지.

### L3. DB 레벨 불변식 — "무조건"의 핵심 (앱 우회 불가)
앱 코드는 버그날 수 있으나 DB 제약은 **대량·직접·우회 입력도 막음**:
- **트리거/제약**:
  - `supply_quotes`: confirmed면 `supplier_id IS NOT NULL` + `product_id IS NOT NULL` 강제(CHECK/트리거).
  - `gpu_count >= 1` CHECK. 활성 견적 1건/(product,supplier,term) 유지(부분 유니크 — 일부 존재).
  - 단위 표준 보증: `per_gpu_usd` = **생성컬럼**(`unit_price_usd / gpu_count`) → 읽기측이 재계산 못 해도 항상 동일.
- **dedup 정규화 키**: model/memory 정규화 컬럼 + **canonical 유니크**(vcpu 제외) → 같은 모델 분리 차단. find-or-create는 `INSERT … ON CONFLICT` 한 경로.
- **FK ON DELETE** 정리: 재고/견적 제거 시 연쇄·정합 유지.

### L4. 원자적 캐시 무효화 — "동시 반영" 보증
- 변경 1회 → `revalidateGpu()` 하나가 **모든 의존 SWR 키 / Next 캐시태그 동시 무효화**. 라우트별 부분 mutate 금지.
- Next `revalidateTag('gpu-catalog')` + 단일 SWR 키 레지스트리 → 한 번 쓰면 4개 메뉴가 같은 read를 동시 재요청.

### L5. CI 정합성 테스트 — "수정 시 모두 점검" 자동화
- 변경 후 `/products·/market·/inventory·/catalog`가 **같은 상품에 동일 가격**을 반환하는지 단언하는 parity 테스트.
- 라우트가 repository 우회(raw insert)하면 실패하는 **가드 테스트**(grep 기반).
- → 미래에 누가 조금이라도 고쳐 정합이 깨지면 **빌드 실패** = 사람이 안 봐도 자동 점검.

## 3. 어디까지 강제? (방어 깊이)
- **L1+L2+L4(앱 단일화)**: 빠름, 마이그레이션 적음. 단 DB 직접/우회 입력은 못 막음.
- **+L3(DB 불변식)**: 대량·우회까지 "무조건" 보증. 단 트리거/생성컬럼 → 복잡도·디버깅 비용↑, 마이그레이션 필요.
- **+L5(CI 테스트)**: 회귀 영구 차단.
- 사용자 요구("무조건")엔 **L1~L5 전부(권장)** — 신뢰도가 핵심이고 대량 입력이므로 DB 레벨까지.

## 4. 트레이드오프
- DB 트리거/생성컬럼은 03에서 "파생은 앱 util" 결정과 구분: **파생 계산=앱 util(L2)**, **불변식 강제=DB(L3)**. 역할 분리(계산 vs 보증).
- 초기 구축 비용↑(서비스 레이어 추출 + 마이그레이션) but 이후 수정 1곳·자동 점검으로 신뢰도 확보.

## 5. 진단 요약
- ❓ "단일로 가져와 무조건 틀어질 수 없게 가능?" → **가능, 단 현재는 정반대(분산+DB보증 0).**
- 해법: **쓰기 단일 서비스(L1) + 읽기 단일 util(L2) + DB 불변식(L3) + 원자 무효화(L4) + CI parity(L5).** L3·L5가 "사람이 안 봐도 무조건"의 실질 보증.

## 6. 확정 결정 (2026-06-03 승인)
- **강제 깊이 = 전체 5중 방어(L1~L5)** ✅
  - L1 단일 쓰기 서비스(repository.ts) — 라우트 raw insert 금지
  - L2 단일 읽기 util(getGpuCatalog) — effective 산출 SSOT
  - L3 DB 불변식(트리거·CHECK·생성컬럼 per_gpu·canonical 유니크) — **우회 불가**
  - L4 revalidateGpu() 원자적 캐시 무효화 — 동시 반영
  - L5 CI parity + raw-insert 가드 테스트 — 회귀 자동 차단
  - → 대량·우회 입력에도 사람이 안 봐도 "무조건" 정합.
