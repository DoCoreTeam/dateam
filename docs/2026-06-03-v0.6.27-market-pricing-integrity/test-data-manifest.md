# 테스트 데이터 매니페스트 (UI 통합테스트 — 2026-06-03)

> docs 02 §2 원칙: UI 등록 플로우로 검증, 표식 후 일괄 정리.

UI(인증 세션)에서 등록한 테스트 데이터. 검증 후 cleanup-testdata.sql로 정리(승인 후).

| 테이블 | id | 설명 | 등록경로(UI) | 등록시각 |
|--------|----|------|------|--------|
| suppliers | 21da323a-2640-4cc2-a6c8-d8ce69637225 | `[[TESTDATA 2026-06-03]] RalphTest` 공급사 | 가격표 견적등록 API(브라우저 세션) | 2026-06-03 |
| supply_quotes | f9df735b-46bf-4ea9-aabc-4a824a553827 | B200 ×1 $2.00/GPU confirmed (1장당 전파 검증용) | 견적등록→확정 | 2026-06-03 |
| availability_responses | (supplier_id=위 supplier) | B200 ×1 RalphTest 가용 5 GPU, is_test=true | 재고수량 인라인 입력(실제 클릭) | 2026-06-03 |

## 검증 결과 (UI 통합테스트)
- 1장당 전파: $2.00 → 전 구성(×1/×2/×4/×8 = 2/4/8/16) 4개 메뉴 동일 effective ✅
- 가격표 렌더: B200 1장당 ₩3,023(=$2.00) + ×2~×8 "1장당 전파(추정)" 배지 ✅
- 재고 인라인 수량: RalphTest 5 GPU 입력→반영 ✅
- 4개 탭 Tier→모델 카테고리 동일 구조 ✅

## 정리
검증 완료 후 cleanup-testdata.sql 실행 → 실데이터(High Reso $3.24 base) 복원.
