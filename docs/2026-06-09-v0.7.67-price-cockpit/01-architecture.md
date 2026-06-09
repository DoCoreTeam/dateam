# 01 Architecture

## 데이터 레이어
- **strategic_price** 신설: gpu_products(또는 별도 strategic_prices 행)에 `strategic_price_krw numeric NULL` + `strategic_override_reason text` + `strategic_set_by text` + `strategic_set_at timestamptz`.
  - Tier3 `direct_prices.sell_price_krw`(수동가)를 전략가 개념으로 일반화 — 콕핏은 direct_prices(있으면) 또는 strategic_price를 단일 "전략가"로 통합 읽기.
  - 결정: **gpu_products에 strategic_price_krw 컬럼 추가**(모델·구성 단위 1전략가). direct_prices는 기존 유지하되 콕핏 전략가 해석 시 우선순위 정의.
- audit: gpu_audit_logs action_type에 'strategic_price_set' 추가(마이그레이션).

## 계산 SSOT (buildCatalog 확장 — lib/gpu/pricing.ts)
한 상품의 콕핏 행 데이터:
```
cost_krw          = effective_unit_price_usd × fx           (원가 floor)
auto_margin_krw   = effective × (1+margin_pct/100) × fx     (자동마진가, 기존 sell_price_krw)
strategic_krw     = strategic_price_krw ?? auto_margin_krw  (전략가, 미입력시 fallback)
is_strategic_set  = strategic_price_krw != null
market_median_krw = market_prices median × fx
effective_margin_pct = (strategic_krw - cost_krw)/cost_krw × 100
market_deviation_pct = (strategic_krw - market_median_krw)/market_median_krw × 100   (시장데이터 있을때만)
```
- 전부 read-time 파생(strategic_price_krw만 저장). 회귀: 기존 sell_price_krw = auto_margin_krw 유지.

## 시그널 SSOT
- `lib/gpu/price-signal.ts`: `marginSignal(pct)→'danger'|'ok'|'over'`, `deviationSignal(pct)→'cheap'|'ok'|'expensive'`. 임계 상수.
- `lib/tokens/status-colors.ts`에 `PRICE_SIGNAL` 색 매핑(토큰 var 참조).

## 포맷 SSOT
- `lib/gpu/format-price.ts`: fmtKRW/fmtUSD 단일화 → 콕핏·PriceTableTab·MarketTab·catalog 공용(중복 3곳 제거).

## API
- `PATCH /api/pricing/gpu/strategic-price` (또는 products/[id] 확장): strategic_price_krw set/clear. admin+audit('strategic_price_set')+revalidateGpu.
- 콕핏 데이터: 기존 `/api/pricing/gpu/products`(buildCatalog) 확장 — 추가 파생 필드 포함. market_median은 products 응답에 병합하거나 콕핏이 products+market 2콜 병합.

## UI
- 신규 탭 "가격 결정"(GpuPricingClient 탭 등록, 가격표 탭 유지).
- `PriceCockpitTab.tsx`: 골격 6컬럼 + 3색 시그널 + 전략가 인라인 편집(연필) + 행 펼침 Drawer.
- 고객판매가격표(catalog/page.tsx): getSellPrice가 strategic_krw 사용(흡수).
- 토큰: `--fs-price` 등 globals.css :root, `.price-cockpit-*` 공용클래스 1벌.

## 재사용
buildCatalog/config-ladder/audit/revalidate/mutateGpu/format-price/price-signal 전부 SSOT. 신규 추상화 최소.
