# v0.6.27 — 시장비교/가격표 정합성·UX 작업 요약

## 작업
1. **시장 만료 제거**: `market/route.ts`가 48h 초과 가격을 버려 min/max/median=null → 전 행 "데이터 부족"(market 79h 전). → 매핑별 최신가(나이 무관)로 계산, `is_fresh`/`hours_ago`는 표시 전용.
2. **시장비교 카테고리 그룹핑**: 가격표처럼 Tier(1/2/3) 그룹 헤더로 묶고 **기본 접힘**.
3. **가격표 카테고리 기본 접힘**: 기존 모델 그룹(`collapsedModels`)을 데이터 로드 시 전부 접힘으로 초기화.
4. **공급사 정합성**: confirmed 견적 10건이 `supplier_id` NULL(데모 데이터, 원본 복구 불가) → ① UI "—" → "공급사 미지정"(앰버) 일관 표기 ② 확정 라우트 공급사 필수 가드(재발 방지). **데이터 파괴/조작 없음**(보호 원칙).
5. **새로고침 가시화**: per-URL 결과(`results[]`) 상세 표시(성공/실패 사유).

## 수정 파일
- `apps/web/app/api/pricing/gpu/market/route.ts`
- `apps/web/app/(member)/pricing/gpu/tabs/MarketTab.tsx`
- `apps/web/app/(member)/pricing/gpu/tabs/PriceTableTab.tsx`
- `apps/web/app/api/pricing/gpu/quotes/[id]/confirm/route.ts`

## 근거 데이터 (psql 라이브)
- confirmed 견적 118건 중 공급사 NULL 10건(그중 product NULL 4건), 공급사 4곳
- market_prices 105행, 최신 79시간 전 → 48h 필터로 전부 숨김

## 영향 범위
- 시장비교 화면 즉시 복구(기존 105행 표시). 가격표/시장비교 기본 접힘으로 첫 화면 간결.
- 신규 확정 견적은 공급사 필수 → 정합성 보장.
