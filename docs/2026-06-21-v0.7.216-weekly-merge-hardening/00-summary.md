# FAST PATH Summary — v0.7.216 주간보고 병합 견고화 + 영구 E2E

작업: v0.7.215 병합 픽스의 잔여 갭 2건 마감.
1. **중첩 `<ul>` 견고화** (DC-REV M1): `extractItems`의 비탐욕 정규식이 중첩 리스트를 평탄화하던 문제를, 깊이 추적 top-level `<li>` 추출(`extractTopLevelLis`)로 교체. 중첩 항목은 부모 항목 내부에 보존.
2. **영구 E2E 회귀 스펙**: `apps/web/e2e/weekly-report-merge.spec.ts` 신규. route mock으로 daily/week·generate-from-tasks를 고정해 결정적으로, 두 번 연속 생성하여 (a)신규 추가 (b)미포함 행 보존 (c)동일 카테고리 병합+중복제거를 검증.

대상:
- `apps/web/lib/weekly-report/merge-rows.ts` (extractTopLevelLis 추가, extractItems 내부 교체)
- `apps/web/lib/weekly-report/merge-rows.test.ts` (중첩 케이스 2건 추가 → 15건)
- `apps/web/e2e/weekly-report-merge.spec.ts` (신규, 인증 없으면 graceful skip)
- 버전 0.7.215→0.7.216 (root/apps-web package.json, CLAUDE.md, AGENTS.md)

이유: 병합 로직의 엣지(중첩 리스트) 정확성 보강 + onGenerate 배선 회귀를 단위테스트만으로는 못 잡으므로 E2E로 영구 커버.

검증:
- 단위 391/391 통과(중첩 2건 포함), tsc 0, design:check 통과
- E2E 2 passed (setup + 병합 회귀) — throwaway 계정 세션으로 실행 확인 후 세션파일·계정 정리(실데이터 무오염)

영향: 표시/저장 동작 동일, 중첩 리스트 입력 시에만 더 정확. 기존 호출처 변화 없음.
