# 03 Test Strategy

## 단위 테스트 (lib/gpu)
- config-ladder: roundUpToStandard(1→1,2→2,3→4,5→8,6→8,7→8,8→8,9→8), perGpuUnitPrice, priceForStandardConfig 경계.
- ensureStandardConfigs: 비표준 입력 시 표준단만 생성, 1장환산 가격 정확.
- impact.countImpact: 참조 N건 정확.
- audit.recordGpuAudit: before/after 기록.

## 통합 테스트 (API)
- review confirm: x3 견적 → x4로 정규화 저장 + 사다리 보충 확인.
- supply_quotes DELETE → 소프트삭제(deleted_at set), buildCatalog 제외 확인. 참조 있으면 차단/경고.
- gpu_products POST → 생성 + 사다리 자동 보충.
- market/prices PATCH → 수정 반영.
- settings PATCH/fx POST → revalidateGpu로 4탭 즉시 반영(stale 0).

## E2E (Playwright, throwaway 데이터)
- 가격표에서 견적 인라인 수정 → 시장비교/재고/고객판매가 동시 반영 확인(cascade).
- 비표준 견적 통합입력→확정 → 가격표에 x4로만 표시(비표준 노출 0).
- 삭제 시 영향 프리뷰 다이얼로그 → 소프트삭제 후 목록에서 사라짐.
- 반응형: 768/1024 카드 레이아웃 확인.

## 게이트
- `npx tsc --noEmit -p apps/web/tsconfig.json` 0 에러
- `node scripts/check-design-tokens.mjs` PASS
- 단위 테스트 PASS (80%+ 목표)

## 테스트 격리
- throwaway 모델명(`[TEST]` 접두 또는 is_test) 사용. 운영 견적/실데이터 오염 금지. 종료 시 cleanup.
