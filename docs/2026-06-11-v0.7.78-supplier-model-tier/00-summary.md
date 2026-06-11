# v0.7.78 — 공급사+모델별 Tier override (라벨 전용)

## 작업
같은 모델(예 H100)이라도 공급사마다 다른 Tier(1/2/3)로 분류·표시할 수 있게. 사용자 확정: **① 라벨만(가격 계산 불변) ② 공급사+모델 단위**.

## 배경(DC-ANA)
현재 tier는 gpu_products(모델 단위) 1개. 공급사별 지정 불가. tier는 가격 계산에 안 쓰이고 분류/이상탐지 라벨일 뿐. → 공급사+모델 override 저장소 신설 + 표시에만 반영(가격 무변경).

## 수정 파일
- `supabase/migrations/085_supplier_model_tier.sql` (신규) — supplier_model_tier(supplier_id, model_name, tier, UNIQUE) + RLS(all read/service write). **적용 완료**.
- `apps/web/app/api/pricing/gpu/suppliers/[id]/model-tier/route.ts` (신규) — PUT upsert(tier 1/2/3)/삭제(null), admin, revalidate.
- `apps/web/app/api/pricing/gpu/suppliers/[id]/route.ts` — GET 견적에 tier override 부여(effective_tier = override ?? gpu_products.tier).
- `apps/web/app/(member)/pricing/gpu/tabs/SuppliersTab.tsx` — 공급사 상세 견적행에 Tier 뱃지(effective) + admin Tier 셀렉트(자동/T1/T2/T3) override.

## 이유
"A사 H100=T1, B사 H100=T2" 분류 요구. 가격은 불변(사용자 명시) → buildCatalog 무수정, 리스크 최소.

## 영향 범위
- 가격 계산 경로(pricing.ts) **무변경**.
- 공개 API 무변경(supplier_model_tier 미노출).
- 공급사 상세 모달에서 set/표시. (모델 단위 gpu_products.tier는 그대로 — 기본 분류 유지)
