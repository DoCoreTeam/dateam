# 03 테스트 전략

## 단위(node:test — 자기완결 모듈만. DECISION-20260612-test-strategy 참조)
> 이 레포의 node:test는 strip-types 런타임이라 전이 상대 import 모듈은 단위 테스트 불가.
> SSOT를 import하는 글루(unified-views·resolveCell·cockpitToUnified)는 **E2E로 커버**.
- csv-intake.test.ts — 헤더 자동 매핑 · `=`/`+`/`-`/`@` 선두 셀 무력화(자기완결 모듈)
- confidence-gate.test.ts — ≥90 auto / 70~90 review / <70 block 경계값(자기완결 모듈)
- 기존 골든세트(pricing/golden-eval) 무회귀 확인 (loop4: 72 pass/0 fail ✅)

## 통합
- 신규 읽기 API 4개: 정상 응답·권한·빈/에러 3종 (mock supabase)
- RBAC: member가 마스터 쓰기 시 403, 읽기 200

## E2E(Playwright, apps/web/e2e)
- 통합 표: 보기 전환 시 컬럼 교체, 행 선택→상세 패널, 인라인 CRUD
- 통합 입력: 멀티모달 드롭→추출→신뢰도 게이트(자동/검토/차단)→변경분 diff→확정
- 반응형: 모바일 목록→상세 풀스크린
- 접근성: 키보드 보기 전환, 상태 텍스트 병기

## 게이트
tsc(apps/web) · pnpm test · pnpm design:check · pnpm exec playwright test 모두 그린.
