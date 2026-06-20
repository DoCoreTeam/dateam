# FAST PATH Summary — v0.7.215 주간보고 "일일업무에서 생성" 병합

작업: "일일업무에서 주간보고 생성"이 기존 폼 내용(이월 성과·저장본·수동입력)을 통째로 덮어쓰던 버그를, **카테고리 키 기준 + 성과/계획/이슈 셀 단위 불릿 병합(중복제거)**으로 변경.

대상:
- `apps/web/lib/weekly-report/merge-rows.ts` (신규 — SSOT 병합 로직)
- `apps/web/lib/weekly-report/merge-rows.test.ts` (신규 — 단위테스트)
- `apps/web/app/(member)/weekly-report/WeeklyReportForm.tsx` (onGenerate 콜백 1곳 — `setRows(generatedRows)` → `setRows(prev => mergeWeeklyRows(prev, generatedRows))`)
- `apps/web/package.json` test 목록에 merge-rows.test.ts 추가

이유: `WeeklyReportForm.tsx:405-407`의 `onGenerate`가 `setRows(generatedRows)`로 기존 state를 **교체(replace)**해 이월/저장/수동 내용이 소실. 저장본이 로드된 상태에서 생성→저장 시 DB 데이터까지 손실되는 경로였음.

병합 정책 (SSOT):
- 생성 카테고리가 기존에 **없으면** → 새 행 추가
- 생성 카테고리가 기존에 **있으면** → 그 행의 각 셀(성과/계획/이슈)에서 `<li>` 항목을 합집합(기존 우선, 텍스트 정규화 후 중복 제거). 빈 셀은 상대 값으로 채움.
- 기존이 완전 빈 행(EMPTY_ROW)뿐이면 정리 후 생성 결과로 채움. 결과가 비면 EMPTY_ROW 1개 유지.

영향:
- 드래프트(localStorage): rows state 병합으로 자연 보존됨.
- 초기화 버튼/AI로 다듬기: 독립 경로 — 영향 없음 (각각 재마운트/별도 setRows).
- DailyTaskSelector·생성 API·DB 스키마: 변경 없음.

검증: 단위테스트(merge-rows) + Playwright 실브라우저 회귀(이월 성과 보존, 동일 카테고리 불릿 병합, 신규 카테고리 추가, 저장본 보존).
