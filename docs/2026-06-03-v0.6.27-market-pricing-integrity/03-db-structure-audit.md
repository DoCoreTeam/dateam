# GPU 관리 DB 구조 점검 — 통합인가 분절인가 (분석 전용)

> 상태: **분석 전용 — 구현 금지** · 2026-06-03 · psql 실측

## 결론 (한 줄)
**테이블은 통합형(메뉴별 별개 아님)** — 단일 허브 `gpu_products` 중심. 다만 **통합이 절반만 완성**: SSOT 마스터 뷰가 방치되고, "1장당 단가 전파" 파생이 한 곳에 없어 **메뉴 간 값이 갈릴 수 있음**(사용자 우려 = 실재 위험).

## 1. 구조 — 단일 허브 (통합 O)
중심 `gpu_products`(136행)에 모든 도메인이 FK로 연결. 메뉴마다 별도 테이블 아님:

```
                     gpu_products (136) ── 허브
   ┌──────────┬──────────┬──────────┬──────────┬──────────┬─────────┐
 supply_quotes  competitor_  availability_  direct_     direct_pool_  supply_history
 (118)          product_     responses(0)   prices(0)   stock(10)     _stats
   │            mapping(50)      │                          
 suppliers(4)     │          suppliers
              competitors(12)
              │
            market_prices(105)
```
- 우리 공급: `supply_quotes → gpu_products + suppliers`
- 경쟁사: `market_prices → competitor_product_mapping → competitors`
- 가용량: `availability_responses → gpu_products + suppliers` (0행)
- Tier3: `direct_pool_stock`(10) / `direct_prices`(0)

## 2. 읽기 경로 — 공유 뷰 (부분 통합)
| 메뉴 | API | 主 소스 |
|------|-----|---------|
| 가격표 | `/products` | gpu_products + **v_lowest_quotes** + direct_prices |
| 고객 판매가격표 | **`/products` (동일!)** | 〃 — 가격표와 100% 동일 소스 ✅ |
| 시장 비교 | `/market` | gpu_products + competitor_mapping + market_prices + **v_lowest_quotes** + strategy |
| 재고수량 | `/inventory` | gpu_products + v_fresh_availability + v_product_availability_summary + **v_lowest_quotes** |
| 검토 대기 | `/review` | review_items + supply 관련 |
| 공급사 | `/suppliers` | suppliers + **v_lowest_quotes** |

→ **최저 공급가는 `v_lowest_quotes` 하나를 4개 메뉴가 공유** → 그 값은 일관. 고객가=가격표 동일 API.

## 3. 문제 — 통합이 "절반"만 완성

### 3-1. SSOT 마스터 뷰 방치 (CRITICAL)
- `v_gpu_master` 존재: gpu_products + 최저견적 + 직접가 + 가용량요약 + 풀재고를 LEFT JOIN한 **완성형 단일 뷰**.
- **사용처 0곳** — 모든 라우트가 이 뷰를 안 쓰고 **제각각 재조인**.
- 결과: 파생 규칙(가용 null 처리·has_active_quote·직접가 우선순위 등)이 라우트마다 흩어져 **불일치 가능**.

### 3-2. "1장당 단가 전파"가 SSOT에 없음 (사용자 우려 직결)
- `v_lowest_quotes` = `DISTINCT ON (product_id)` → **상품(=gpu_count 구성)별 최저**. **모델 단위 전파 없음.**
- 그래서 B200 ×1=$3.24인데 ×2/×4/×8은 각자 견적($13.83…)으로 따로 나옴.
- 전파는 **가격표 클라이언트에서만 부분(누락 구성 합성)** 처리 → 시장비교·재고·고객가는 전파 안 함.
- → **같은 모델의 같은 구성이 메뉴마다 다른 가격으로 보일 수 있음** = 사용자가 우려한 바로 그 현상.

### 3-3. 데이터 공백 (구조 아닌 입력 부재)
- `availability_responses` 0행 → 재고 수량 빈다. `direct_prices` 0행 → 직접가 빈다.
- 구조는 정상, **입력 동선 부재**가 원인(02 문서에서 해결).

## 4. 개선 방향 (이전 기획과 연결 — 메뉴 불일치 원천 제거)
1. **파생을 단일 지점화**: `lib/gpu/pricing.ts`(또는 `v_gpu_master` 확장)에서 **1장당 전파 포함 effective price/effective supplier**를 산출. 모든 메뉴가 이 단일 산출을 읽음.
2. **모든 main 라우트가 v_gpu_master(확장판) 또는 공용 util 1개를 거치게 통일** → products/market/inventory/catalog가 동일 계산 결과 공유 → 메뉴 간 값 불일치 구조적 제거.
3. **v_gpu_master 살리기**: 방치된 마스터 뷰를 1장당 전파·effective 컬럼 포함하도록 재정의하고 라우트들이 이를 단일 소스로 사용. (또는 뷰는 폐기하고 서버 util로 일원화 — 둘 중 택1, 아래 결정)
4. 가용량/직접가는 02 문서대로 UI 입력 동선 추가.

## 5. 진단 요약
- ❓ "메뉴별 테이블이 별개?" → **아니오.** gpu_products 단일 허브 + 공유 뷰. 통합형.
- ❓ "통합 관리하며 정확히 분석해 쓰나?" → **절반만.** 공유는 하나 ① 완성형 SSOT 뷰(v_gpu_master) 미사용 ② 1장당 전파가 SSOT에 없어 메뉴 불일치 위험. → 단일 산출 지점으로 통일 필요.

## 6. 확정 결정 (2026-06-03 승인)
- **SSOT 일원화 = 서버 공용 util `lib/gpu/pricing.ts`** ✅
  - `bestPerGpu(model variants)` / `effectiveUnitPrice(config)` / `effectiveSupplier(config)` 단일 산출.
  - products·market·inventory·catalog 라우트가 **모두 이 util을 거쳐** 동일 effective 값을 반환 → 메뉴 불일치 구조적 제거.
  - 마이그레이션 불필요, 테스트·디버깅 용이. `v_lowest_quotes`는 원천(구성별 최저)으로 유지하되, 모델 단위 전파는 util이 담당.
  - (방치된 `v_gpu_master`는 혼선 방지를 위해 폐기 또는 보조로 강등 — 구현 시 판단.)
