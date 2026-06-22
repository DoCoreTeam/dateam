# FAST PATH Summary — 취합 주간보고 부서뷰 Word(docx) 내보내기

작업: 어드민에만 있던 주간보고 docx 내보내기를 멤버 화면 취합 주간보고(`OrgWeeklyView` 부서뷰)에 동일 적용. docx 구조는 어드민과 동일(SSOT `buildDocx`), 부서명만 해당 부서명으로 주입.

대상:
- `apps/web/app/(member)/weekly-report/org-actions.ts` — 서버액션 `exportDeptDocx(deptId, weekStart, rows)` 신설
- `apps/web/app/(member)/weekly-report/OrgWeeklyView.tsx` — `DeptReport` 헤더에 "Word 내보내기" 버튼 + base64 다운로드

이유:
- 어드민 export 라우트(`app/api/reports/export*`)는 `role==='admin'` 게이트라 멤버 화면에서 재사용 불가.
- docx 생성 로직은 이미 `lib/docx-builder.ts`의 `buildDocx(ReportRow[])`가 SSOT. 팀(부서) 보고서는 `userName:''` + `orgName=부서명` 입력 시 부서명이 rowSpan 헤더로 들어감 → "부서명 주입" 요구가 SSOT에 이미 내장.
- 따라서 멤버 화면 인증패턴(`org-actions.ts` + `scope.readableDeptIds`)을 쓰는 서버액션을 신설하고, 내부에서 `buildDocx`를 그대로 호출 = SSOT 재사용·구조 동일성 보장.

영향:
- `lib/docx-builder.ts`: 무수정(재사용만)
- `lib/org-scope.ts`: 무수정(readableDeptIds 권한 확인만)
- DB 변경 없음. 새 의존성 없음(`docx` 기존 의존).

보안:
- 서버액션은 인증 + `scope.readableDeptIds.includes(deptId)`로 행 수준 권한 검증(default-deny). 권한 없으면 거부.
- 클라이언트가 보내는 rows는 화면에 표시 중인 취합본(WYSIWYG, 어드민 export-preview와 동일 패턴). 길이/형태 방어적 정규화.
- 부서명·weekStart는 클라이언트 입력이 아닌 서버 scope/검증값 사용.
