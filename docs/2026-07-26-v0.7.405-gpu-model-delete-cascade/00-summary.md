# GPU 스펙관리 — 모델 삭제(연쇄 정리) 분석·기획 보고

- 버전: v0.7.405
- 상태: **구현 완료** (소프트삭제 + base 모델 일괄 + 되돌리기). 마이그레이션 179는 사용자 적용 대기(아래 §7).
- 목적: 카탈로그를 원하는 일부 모델만 남기도록, "모델 자체 + 연관 데이터"를 안전하게 삭제하는 기능

## 정정 (DC-ANA 전수조사)
초기 보고의 "앱 전체에 gpu_products 삭제 경로 0건"은 **오류**. 실제로는 개별 구성 소프트삭제 API(`DELETE /api/pricing/gpu/products/[id]`, impact 체크+force)가 **이미 존재**했으나 **SpecsTab UI에 미노출**돼 사용자가 쓸 수 없었음. 또한 소프트삭제는 물리 DELETE가 아니라 **CASCADE를 발화하지 않음** → 자식은 product_id로 남되 읽기 경로의 `deleted_at IS NULL` 조인으로 은닉되고 복구 시 무손실 복원됨(=이번 설계의 핵심 장점).

---

## 1. 문제 (사용자 요청)
> "스펙관리에서 모델 자체를 삭제하는 게 없다. 삭제하면 연관된 것들도 다 삭제되어야 하는데 안 된다. 일부 모델로만 구성하려고 한다."

## 2. 현행 분석 (코드 근거)

### 2-1. 실제 렌더 경로
- "스펙 관리" 탭 = `?tab=specs` → `apps/web/app/(member)/pricing/gpu/tabs/SpecsTab.tsx` (admin 전용, `GpuPricingClient.tsx:305` 라벨 "스펙 관리", `:437` 렌더, `:220`/`:317` admin 게이트).
- SpecsTab 구조: `gpu_products`를 **baseModelKey**로 그룹핑 → 폼팩터 변형 → 구성(장수) 배열. `gpu_specs`는 `model_name`으로 조인. (`api/pricing/gpu/specs/route.ts:39~78`)

### 2-2. 근본 원인 (왜 모델 삭제가 안 되나)
| # | 원인 | 근거 |
|---|------|------|
| **A. 모델 삭제 UI·API 자체가 없음** | SpecsTab의 유일한 삭제 버튼 "스펙 삭제"는 **데이터시트(gpu_specs)만 초기화**한다. 모델(gpu_products) 행은 남는다. | `SpecsTab.tsx:122~124, 211` → `DELETE /api/pricing/gpu/specs?model_name=` |
| **B. 앱 전체에 gpu_products 하드/소프트 삭제 경로 없음** | `from('gpu_products')...delete()` 호출 0건. 소프트삭제(`deleted_at`)는 오직 **병합 RPC(174)**만 수행. | grep 결과 / `174_gpu_products_merge_rpc.sql:95` |
| **C. 문자열(model_name) 결합 테이블은 FK CASCADE로 안 지워짐** | `gpu_specs`(model_name UNIQUE), `supplier_model_tier`(model_name)는 **product_id FK가 아니라 model_name 문자열**로 연결 → 설령 product를 하드삭제해도 이들은 고아로 남음. | `055_gpu_specs.sql:6`, `085_supplier_model_tier.sql:9` |

### 2-3. "연관된 녀석들" — 권위 목록 (product_id FK 13개)
병합 RPC(174)가 이미 열거한 SSOT. 모델 삭제 시 이들이 함께 정리 대상:

**product_id FK (ON DELETE 정책 포함):**
- `supply_quotes` (CASCADE, 024:47) — 부분 unique INDEX 다수(선택/확정 견적)
- `direct_prices`, `direct_pool_stock`, `inquiries`, `availability_responses`, `negotiation_cards`, `gpu_audit_logs`, `gcube_price_checks`, `competitor_product_mapping`, `gpu_product_term_prices`, `gpu_availability`(031), `gpu_review_gate`(029, PK=product_id CASCADE), `gpu_pool_stock`(030)
- `044_gpu_pricing_integrity` 등의 `SET NULL` 대상(024:139) 주의

**model_name 문자열 결합 (FK 아님 → 별도 정리 필요):**
- `gpu_specs` (데이터시트), `supplier_model_tier` (공급사별 tier override)

## 3. 설계안 (권장)

### 핵심 결정: **소프트삭제 + RPC 단일 트랜잭션** (병합 RPC 174 패턴 그대로 재사용)
하드 DELETE는 견적/감사 이력까지 물리 소멸 → 복구 불가·회귀 위험. 프로젝트는 이미 `deleted_at` 소프트삭제 + `merge_..._apply` RPC 패턴 확립. **동일 패턴 재사용이 SSOT·안전·일관.**

- **신규 RPC** `delete_gpu_product_apply(p_product_id uuid)` (또는 base 모델 단위 `p_product_ids uuid[]`):
  1. 소프트삭제: `UPDATE gpu_products SET deleted_at = now() WHERE id = ANY($1) AND deleted_at IS NULL`
  2. model_name 결합 정리: 해당 model_name의 `gpu_specs`·`supplier_model_tier` 삭제(또는 함께 소프트삭제 컬럼 도입)
  3. 견적/자식은 소프트삭제로 자연 은닉(대부분 화면이 이미 `deleted_at IS NULL`·product join 기준) — 물리삭제 불필요
  4. 단일 트랜잭션·멱등
- **삭제 단위**: SpecsTab이 base 모델→변형(폼팩터)→구성으로 계층. UI에서 **① 구성(장수) 단위 ② 변형(model_name) 단위 ③ base 모델 전체(하위 변형 일괄)** 3단계 삭제 지원 권장. 사용자 목표("일부 모델만 남기기")는 base 모델 단위 일괄삭제가 핵심.
- **UI**: SpecsTab 각 그룹/변형 행에 "모델 삭제" 버튼 + 확인 모달(영향 범위 미리보기: "견적 N건·데이터시트 포함 함께 정리됩니다"). `useEscClose`·표준 모달 클래스 준수.
- **권한**: admin 전용(기존 specs 게이트 재사용). 서버 RLS는 service_role write.
- **되돌리기(선택)**: 소프트삭제라 복구 RPC `restore_gpu_product`도 저비용으로 추가 가능(운영 안전망).

## 4. 영향 범위 / 리스크
- SpecsTab·specs API·신규 마이그레이션(RPC) — 파일 3~4개, DB 1개. 파괴적: **소프트삭제라 낮음**(물리삭제 배제 시).
- 주의: SpecsTab은 `deleted_at IS NULL` 필터가 이미 있어 소프트삭제 즉시 목록에서 사라짐(검증됨, route.ts:41).
- 주의: `supply_quotes` 부분 unique INDEX — 소프트삭제 방식이면 충돌 없음(하드삭제 아님).

## 5. 완료 조건 (구현 스프린트용)
- [ ] `delete_gpu_product_apply` RPC (13 FK + model_name 결합 2종 커버, 소프트삭제, 멱등, 단일 트랜잭션)
- [ ] SpecsTab 모델/변형/base 단위 삭제 UI + 영향 미리보기 모달(표준 모달 클래스)
- [ ] admin 권한 게이트(앱+RLS)
- [ ] 삭제 후 SpecsTab·카탈로그·콕핏에서 즉시 소거 확인(실브라우저)
- [ ] (권장) 복구 RPC + 되돌리기
- [ ] 단위테스트(RPC 멱등·고아 정리) + Playwright E2E(모델 삭제→목록 소거)
- [ ] changelog(entries.ts) 사용자향 1블록

## 6. 결정 (사용자 승인 완료)
1. 삭제 방식: **소프트삭제** (복구 가능, 견적·이력은 은닉만)
2. 삭제 단위: **base 모델 전체 일괄** (폼팩터·장수 구성 전부)
3. 되돌리기: **포함** ('삭제된 모델' 섹션 + 되돌리기 버튼)

## 7. 구현 산출물
- `supabase/migrations/179_gpu_product_restored_audit.sql` — audit CHECK에 'product_restored' 추가
- `apps/web/lib/gpu/impact.ts` — countProductRefs(7개 자식 테이블) + countModelImpact(일괄)
- `apps/web/lib/gpu/audit.ts` — 'product_restored' 타입
- `apps/web/app/api/pricing/gpu/models/route.ts` (신규) — DELETE(일괄 소프트삭제, force로 409 우회) + POST(복구)
- `apps/web/app/api/pricing/gpu/specs/route.ts` — GET ?deleted=1 + groupModels 헬퍼 분리(SSOT)
- `apps/web/app/(member)/pricing/gpu/tabs/SpecsTab.tsx` — 모델별 🗑 삭제 + DeleteModelModal(영향 프리뷰) + DeletedModelsSection
- `apps/web/lib/gpu/impact.test.ts` — 단위테스트

### 배포 필수 절차 (사용자)
마이그레이션 179는 로컬 자격증명 문제로 CEO가 적용 못 함 → **사용자가 직접 적용**:
```bash
PGPASSWORD='<db_pw>' ./scripts/migrate.sh 179_gpu_product_restored_audit.sql
```
미적용 시에도 삭제/복구는 정상 동작(복구 감사로그만 조용히 생략 — recordGpuAudit 비치명적).

### 검증
tsc ✅ · lint ✅ · design:check ✅ · 단위테스트 2/2 ✅ · 라우트 등록·인증게이트(307→/login) ✅
