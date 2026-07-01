# v0.7.282 — GPU 검토 확정 정형화 (자동판정 + 약정별 저장 + 버그수정)

## 문제 (사용자 관찰)
GPU "검토 대기" 일괄 확정 시 55건 전부 튕김. "메모리 지정하라"는데 지정 UI 없음. reserved 약정 항목 확정 불가.

## 근본원인 (DB 실데이터로 확정)
1. **완전중복 행 오염** — `gpu_products`에 (model,memory,gpu_count) 완전 동일 행이 29개 모델에서 중복(T4 16GB ×3 등). `resolveProductId`가 "같은 장수에 변형 여럿"으로 오판 → `ambiguous_variant` 보류 → 사용자에게 떠넘김. (실제로는 같은 SKU 중복)
2. **일괄 확정 경로가 변형 후보(candidates) 미전달** — `bulk/route.ts:74`가 실패응답에 candidates 누락 → 결과 모달/카드에 변형선택 버튼이 뜰 수 없음(단건 경로에만 존재). 안내는 있는데 수단이 없는 막다른 골목.
3. **reserved 약정 완전 차단** — `strategic_price_krw` 단일 컬럼이라 on_demand만 저장 가능. `own-target-import.ts:71`이 non-on_demand를 reason 반환하며 차단. code 미반환이라 조치 안내도 없음.

## 방침: 정형화를 주 경로로, 수동을 예외로
사용자 지시("AI가 정비/정형화해야 할 일"). 사용자에게 떠넘기기 전에 결정론적 정형화로 자동 해소.

## 작업 (Phase)
1. **중복 자동판정** (resolve-product.ts) — 후보 정규화메모리 distinct set이 1개면 대표 1행 자동확정(가격 보유행 우선). 진짜 다변형만 ambiguous. 후보는 메모리별 dedup해 제시.
2. **중복 행 정리 마이그레이션** — 완전동일 중복을 FK 재지정 후 대표 1개로 병합/소프트삭제(가격 보유행 보존). 근본 오염 제거.
   ⚠️ **이번 커밋(v0.7.282) 범위 제외 — 사용자 확인 후 별도(v0.7.283)**: 12개 테이블 FK 재지정 + 소프트삭제라 되돌리기 어려운 프로덕션 데이터 변경. 확정 로직(Phase 1)은 이 정리 없이도 대표행으로 결정론 동작하므로 확정은 이미 정상. 미정리 상태에서는 가격표에 중복 SKU 행이 남아 보이는 **기존(선재) 데이터 품질 문제**가 지속됨(이번 변경이 유발한 회귀 아님).
3. **약정별 저장** — `lib/gpu/term.ts` term 정규화 SSOT + `gpu_product_term_prices` 테이블(RLS) + import에서 term별 upsert(on_demand는 strategic_price_krw 미러 유지). 차단 제거.
4. **가격표 표시** — getGpuCatalog LEFT JOIN → 가격표에 약정별 가격 노출. **콕핏 원가·마진 계산은 on_demand 대표가로 무변경**(가격엔진 회귀 격리).
5. **bulk 버튼 버그** — 실패응답 candidates/code 포함 → 일괄 확정 후 실패카드에 변형선택 버튼 인라인.

## 비범위 (별도)
term별 cost_basis 분리 계산(견적선택 엔진 재설계), 콕핏 마진 term분리.

## 검증
- resolve-product.test.ts(중복→자동확정, 다변형→ambiguous), term.test.ts(정규화)
- kst/design guard, tsc, next build, Playwright 검토탭 실측(일괄 확정 통과율)
