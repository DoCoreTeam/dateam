# 확정 견적 정합성 정의 — "공급사 미지정"이 애초에 생기지 않게 (2026-06-04)

> 사용자 지적: "공급사 미지정 건들은 애초에 데이터 입력이 되면 안 되는 것. 정의를 똑바로."

## 1. 정의 (필수 불변식)

**`supply_quotes.status = 'confirmed'` 견적은 다음을 반드시 만족한다:**
- `product_id IS NOT NULL` (어느 GPU 모델 견적인지 특정)
- `supplier_id IS NOT NULL` (어느 공급사 견적인지 특정)
- `gpu_count >= 1`

→ 둘 중 하나라도 특정 못 하면 **확정 불가**. `pending`(검토 대기)으로만 보관하고,
   사용자가 검토 화면에서 **상품·공급사를 보정한 뒤에만** 확정한다.

근거: 확정 견적은 가격표·시장비교·재고·고객가 4개 메뉴의 effective 가격·공급사 표시에 직접 쓰인다.
공급사/상품이 비면 "공급사 미지정"·표시 누락 등 **부정확한 데이터**가 노출된다.
**부정확한 데이터는 없는 게 낫다** → 입력 자체를 차단한다.

## 2. 3중 방어 (입력 차단)

| 계층 | 위치 | 규칙 |
|------|------|------|
| 앱 가드 A | `quotes/[id]/confirm/route.ts` | supplier_id·product_id 없으면 400 (기존) |
| 앱 가드 B | `review/[id]/route.ts` 확정 | **신규**: 매칭/find-or-create 실패로 productId·supplierId 못 구하면 422 + 안내(적재 안 함) |
| DB 불변식 | `052_gpu_integrity.sql` 트리거 | confirmed인데 supplier/product NULL이면 RAISE (우회·대량입력도 차단) |

→ 앱이 버그나도 DB 트리거가 최종 차단. 앱 가드는 사용자에게 친절한 한글 메시지 제공.

## 3. 보정 동선 (확정 못 한 견적의 출구)

- 검토 대기(ReviewTab): 공급사/상품 보정 후 확정.
- 이미 적재된 NULL 공급사 견적: **가격표 펼침 행의 "공급사 지정" 인라인 셀렉트**(v0.6.30)로 지정 → 즉시 4메뉴 반영.

## 4. 기존 불량 데이터 정리 (1회성, 2026-06-04)

`restore-null-suppliers.sql` 실행:
- 로그(`gpu_audit_logs.supplier_hint`)에 단서 있는 3건 → 공급사 복원
  (A100 $2.35→Voltage Park, A100 $1.95→Equinix Metal, H100 $5.8→CoreWeave)
- 증거 없는 2건(test 출처, 로그 0건) → 삭제 (GX7000 PRO $4.5, RTX 5090 $9.99)
- 상품 미연결 5건(product_id NULL, 복원 불가) → 삭제
- 결과: confirmed 111건 전부 supplier·product 보유 (NULL 0/0)
