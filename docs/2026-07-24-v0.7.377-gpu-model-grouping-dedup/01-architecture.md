# 01-architecture

## Phase A — 완전중복 병합 (데이터, 마이그 174)

### merge_gpu_products_apply(p_survivor uuid, p_losers uuid[]) — 재사용 SSOT RPC
경쟁사 병합 RPC(133)와 동형. 단일 plpgsql 트랜잭션 = 전부 성공 또는 롤백.
13개 FK 테이블 product_id를 survivor로 재연결. 유니크 충돌은 loser행 삭제(survivor 우선).

| 테이블 | 제약 | 처리 |
|---|---|---|
| competitor_product_mapping | U(competitor_id, gpu_product_id, pricing_model) | 충돌삭제 후 repoint |
| gpu_product_term_prices | U(product_id, term) | 충돌삭제 후 repoint |
| supply_history_stats | PK(product_id) | 충돌삭제 후 repoint |
| price_range_learned | PK(product_id) | 충돌삭제 후 repoint |
| pricing_strategy_config | U(scope, product_id) | 충돌삭제 후 repoint |
| supply_quotes, gpu_audit_logs, gcube_price_checks, direct_prices, direct_pool_stock, inquiries, availability_responses, negotiation_cards | PK(id) | 평범 repoint |

마지막: `UPDATE gpu_products SET deleted_at=now() WHERE id=ANY(p_losers)` (소프트삭제, 무손실).

### 29그룹 적용 (마이그 174 내 DO 블록, 멱등)
그룹키 = (model_name, COALESCE(form_factor,''), COALESCE(memory,''), gpu_count), HAVING count>1.
survivor 선택 = ① strategic_price 보유 우선 ② 참조수(cmap+term+quotes) 많은 순 ③ id 최소(결정론).
losers = 그룹 내 나머지. `merge_gpu_products_apply(survivor, losers)` 호출.
멱등: 이미 병합돼 dup이 없으면 루프가 아무 것도 안 함.

## Phase B — 캐노니컬 그룹핑 + 폼팩터 하위축 (표시)

### baseModelKey SSOT (lib/gpu/canonical-model.ts 신규 export)
```
baseModelKey(name) = coreModelKey(extractFormFactor(name).core)
```
`coreModelKey`는 폼팩터 보존(resolve-product 매칭축)이라 그룹핑엔 부적합.
`extractFormFactor("H100 SXM")={core:"H100",formFactor:"SXM"}` → base "h100". 이 키로만 그룹핑.

### /api/pricing/gpu/specs/route.ts — GET 그룹핑 변경
현재 `byModel` 키 = `p.model_name`(원문). → **base 그룹 + 폼팩터 서브그룹** 2단 구조로 반환:
```
ModelGroup { baseKey, baseName, tier, variants: FormFactorVariant[] }
FormFactorVariant { model_name, form_factor, memory, configs: ConfigRow[] }
```
baseName = 폼팩터 없는 변형의 model_name 우선, 없으면 core. 하위호환 위해 기존 `configs` 평면도 병행 제공(선택).

### SpecsTab.tsx — 렌더 2단 전개
모델 카드(baseName, 총 variant/config 수) → 클릭 → 폼팩터별 섹션 → 각 폼팩터의 수량 사다리(×1/2/4/8).
수량 사다리 = 물리 config 행 있으면 그것, 없으면 표시파생(1장 단가 × 수량, pricing.ts 원리). 새 행 저장 금지.

## SSOT 준수
- 그룹핑 키: baseModelKey 단일 함수(복붙 금지). 다른 화면도 이 함수 import로 확장 가능.
- 수량 파생: config-ladder/pricing 기존 표시 원리 재사용(v0.7.240 no-op 정책 준수).
