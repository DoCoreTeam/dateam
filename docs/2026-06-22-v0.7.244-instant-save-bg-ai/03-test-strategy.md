# 03 테스트 전략

## 단위 (node:test)
- `apps/web/app/(member)/daily/grouping.test.ts` 확장 또는 신규:
  - raw 헤드(ai_processed=false)와 ai_split 자식이 같은 origin_group_id면 한 그룹.
  - 표시용 자식 추출이 raw 헤드를 제외함.
- package.json test 리스트에 신규 파일 추가(자동 포함 안 됨).

## 성능 측정 (R1 < 300ms)
- 낙관적 업데이트로 클릭→입력칸 비움/원문 표시는 동기. Playwright에서
  `performance.now()` 클릭 직전→원문 DOM 등장 시점 차이 측정, < 300ms 단언.

## E2E (Playwright, 본인 직접 실측)
throwaway 계정 or is_onboarding 격리. 시나리오:
1. /daily 진입 → 텍스트 입력 → 저장 클릭
2. 즉시: 입력칸 비고 원문 텍스트가 리스트에 표시(< 300ms)
3. 수 초 내: 같은 그룹 헤더 아래 분해항목(ai_split) 등장
4. 원문 보존: 분해 전/후 원문 헤더 텍스트 유지
5. (옵션) AI 실패 시뮬레이션 어려우면 정상경로 위주, 실패는 단위로 커버

## GATE
- tsc --noEmit, next lint, pnpm test(신규 포함), next build, design:check.
