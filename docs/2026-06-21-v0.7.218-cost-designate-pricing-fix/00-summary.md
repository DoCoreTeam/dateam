# Summary — v0.7.218

## 작업
"공급가 지정(is_selected)"이 **가격결정(판매가 추천·기준 공급원가)에 실제 반영되지 않던 결함** 수정.

## 근본 원인 (실데이터로 증명)
GPU cockpit 라우트(`app/api/pricing/gpu/cockpit/route.ts`)가 buildCatalog의 `effective_unit_price_usd`(지정 채택·유효성·전파·폴백을 모두 반영하는 SSOT)를 **표시·추천에 쓰지 않고**, 별도로 계산한 `costMin`(절대 최저가 — is_selected 지정과 valid_until 만료를 모두 무시)으로 `cost_min_krw`와 `candidate_price_krw`(판매가 후보)를 산출했음.

→ 사용자가 NHN($2.34)을 지정해도 화면은 **만료된 Equinix($1.95)** 기준으로 판매가추천을 냄.

### 실DB 증거 (getGpuCatalog SSOT 직접 호출)
A100 40GB (FX 1523.4, 마진 20%):
- `effective_unit_price_usd = $2.34`, `basis=selected`, supplier=**NHN Cloud**(지정한 공급사)
- **수정 후**: 기준 공급원가 ₩3,565 · 판매가추천 ₩4,278
- **수정 전(버그)**: 절대최저 $1.95 → ₩2,971 · 판매가추천 ₩3,565 ← 화면 버그값과 정확히 일치

## 수정 파일 (DC-REV 권고안 A — `cost_basis_krw` 별도 필드 분리)
- `apps/web/app/api/pricing/gpu/cockpit/route.ts`
  - `costBasisKrw` 도입 = `effective_unit_price_usd × usdKrw`(없으면 `costMinKrw` 폴백)
  - `candidate_price_krw = costBasisKrw × (1+margin)` (기존: costMin × margin)
  - 반환에 `cost_basis_krw` 신설. **`cost_min_krw`/`cost_max_krw`는 절대 단가 범위로 보존**(DrawerSections "범위" 표시 정합 — H1 회귀 차단)
- `apps/web/components/pricing/gpu/cockpit/types.ts` — `CockpitProduct.cost_basis_krw?` 추가(JSDoc: 절대최저 아님)
- `apps/web/lib/gpu/cockpit-to-unified.ts` — `supply_cost_krw: p.cost_basis_krw ?? p.cost_min_krw`(기준원가 우선, 폴백 안전)
- `apps/web/lib/gpu/terms.ts` — `lowestSupplyCost` 라벨 `최저 공급원가` → `기준 공급원가`

## 왜 cost_min을 안 바꾸고 새 필드를 뒀나 (H1)
`cost_min_krw`를 기준원가로 재정의하면 DrawerSections "범위 min~max" 표시가 거짓이 되고(지정가가 중간값이면 실제 최저가 정보 소실), 지정가 > 절대최고 시 min>max 역전 가능. → 범위는 절대 min/max 유지, 가격결정 기준만 `cost_basis_krw`로 분리.

## SSOT 효과 (한 곳 수정 = 전 surface 정상화)
cockpit의 cost_min_krw/candidate_price_krw를 소비하는 모든 화면이 일괄 교정:
- 통합뷰 `DetailPanel`(기준 공급원가) + `PricingDecisionSection`(공급원가·판매가추천)
- 구 콕핏탭 `PriceCockpitTab`(cost_min/candidate 컬럼·정렬)
- `BulkReflectPanel`(auto_price_krw 일괄 전략가 확정)
- `CandidateCell`("이 값으로 지정" 승격)

## 검증
- 실DB×getGpuCatalog SSOT 직접 호출로 수정 전/후 수치 실증
- `tsc --noEmit` 통과 · `pricing.test.ts` 19/19 통과 · `design:check` 통과
- 브라우저 MCP는 프로필 잠금으로 직접 구동 실패 → 라이브 라우트와 동일 SSOT를 실DB에 호출해 라우트 출력값 자체를 증명(핫리로드로 화면 새로고침 시 반영)

## 잔여(범위 외, 후속 권고)
- cockpit 공급사 breakdown(cost_suppliers)에 **만료 견적**(Equinix)이 여전히 행으로 표시됨 — 기준 계산에선 제외되나 목록엔 노출. 별도 표시 정리 권고.
