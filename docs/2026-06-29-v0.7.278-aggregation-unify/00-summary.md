# MEDIUM Summary — 주간보고 취합 "이전 구분 보존" 단일화 + 어드민 패널 정리

## 배경 (분석 결과 — 🟦 DC-ANA 교차검증)
취합 엔진이 실질 2개(+dead 1개):
- **엔진 A** `/api/reports/preview` (어드민 상단 "AI 주간보고 취합", AdminReportsPreview) — `mergeAndRefineByCategory` ctx 없이 호출 → **이전 구분 보존 없음**, 미저장(임시 미리보기).
- **엔진 B** `aggregateDept`(멤버 조직현황 + v0.7.277 어드민 부서패널 DeptReportPanel) — ctx(prevCategories/prevPlans/existingBody) 주입 → **이전 구분 보존 있음**, `dept_weekly_reports` 저장·편집.
- 엔진 C `/api/reports/aggregate-stream` — 호출처 없음(dead code).

"이전 구분 참조→없으면 동일→신규만 추가→최초 구성 생성"의 실체 = `buildMergeContextBlocks`(`lib/weekly-merge-context.ts`) → **엔진 B에만 연결**. 어드민 화면에 A(상단)·B(하단)가 공존해 카테고리가 달라 보였음(이미지 4구분 vs 5구분).

## 결정 (사용자: "너의 추천으로 진행" + "하나로 정리" + "데이터 다 보존")
**SSOT = 엔진 B 보존방식. 어드민 부서 선택 시 단일 패널로 정리, 엔진 A에도 이전 구분 보존 적용.**

## 수정 파일
- `apps/web/app/admin/reports/page.tsx` — 부서(`dept`) 선택 시 상단 `AdminReportsPreview`(엔진 A) 숨김 → 하단 `DeptReportPanel`(엔진 B, 보존형) 단일 노출. 전체/개인 선택 시에만 AdminReportsPreview 유지.
- `apps/web/app/api/reports/preview/route.ts` — `mergeAndRefineByCategory`에 MergeContext 주입: 지난주 `dept_weekly_reports` 구분 목록(prevCategories)을 스코프에 맞게 수집(부서면 해당 부서, 전체면 지난주 전 부서 취합본 구분 합집합), 단일 부서면 이번주 existingBody도. → 엔진 A도 이전 구분 보존.

## 이유
- 사용자: 두 취합 결과가 달라 혼란 → 동일 보존 스타일로 통일. 어드민이 "더 정밀"하다고 느낀 건 보존형(엔진 B). 팀(멤버)은 이미 엔진 B라 변경 불필요.
- SSOT 재사용: 보존 로직은 `buildMergeContextBlocks` 한 곳, 두 엔진이 동일하게 사용.

## 완료조건
- [ ] 어드민 부서 선택 조회 시 취합 패널이 **하나(엔진 B, 보존형)**만 노출 (상단 엔진 A 미표시)
- [ ] 어드민 전체/개인 취합(엔진 A)도 지난주 구분을 참조해 동일 구분 유지(신규만 추가)
- [ ] 최초 취합(지난주 없음)은 구성 생성(빈 ctx → 기본 프롬프트)
- [ ] 멤버 취합 = 어드민 부서 취합 = 동일 SSOT·동일 결과
- [ ] tsc·lint·design·테스트 통과, 🟥 DC-REV PASS, Playwright 실화면 확인

## 제외
- 전체조직 취합본 영구 저장소 신설(엔진 A의 existingBody 완전 보존은 별도 스프린트)
- dead code 엔진 C 삭제(선택)
