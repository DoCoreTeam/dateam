# MEDIUM Summary — 어드민 부서 조회 시 저장 취합본 표시 + 재취합

## 최종 태스크
멤버 화면(주간보고→조직현황)에서 부서 취합 시 `dept_weekly_reports`(body=병합본문, status draft/confirmed)에 저장되는데, 어드민 주간보고 취합(admin/reports)은 이를 안 읽고 raw 원본만 표시. 어드민에서 부서 선택 조회 시 **저장된 취합본을 표시**하고 **재취합**도 가능하게 한다. 멤버/어드민 취합 UI·결과를 SSOT로 일치.

## Q&A 결정사항
1. **표시** = 취합본 우선 + 원본 병행 (상단 취합본, 하단 원본 raw 접이식). 취합본 없으면 원본만 + 취합 가능
2. **확정본 재취합** = 경고 후 덮어쓰기 → 결과는 draft 저장(재확정 필요)
3. **권한** = 어드민은 전 부서 재취합 가능 (현 API는 부서장만 → admin 바이패스 추가)
4. **UI** = 멤버 OrgWeeklyView의 취합 패턴 재사용 (공용 컴포넌트로 추출)

## 수정 파일
- `apps/web/app/(member)/weekly-report/DeptReportPanel.tsx` (신규) — 멤버 OrgWeeklyView 내부 `DeptReport`(취합본 표시+재취합+확정경고 모달+셀편집+저장/확정+Word내보내기)를 공용 컴포넌트로 추출. `normalizeRows`·`FIELDS`·`aggBadge`·타입 동반 이전 (SSOT)
- `apps/web/app/(member)/weekly-report/OrgWeeklyView.tsx` — 추출된 `DeptReportPanel`·`normalizeRows`·`aggBadge` import로 교체, 로컬 중복 정의 제거
- `apps/web/app/(member)/weekly-report/org-actions.ts` — `aggregateDept`·`saveDeptReport`에 admin 바이패스(role='admin'이면 editableDeptIds 무관 전 부서 허용). `aggregateDept` 재취합 결과 status=draft로 변경(기존 confirmed 보존 → 재확정 유도)
- `apps/web/app/admin/reports/page.tsx` — 부서 선택 시 `dept_weekly_reports`(body,status) 조회 → 상단에 `<DeptReportPanel editable>` 렌더(취합본 우선, 전 부서 편집/재취합), 기존 raw 원본 표는 하단 접이식(원본 병행)으로 유지

## 이유
- 사용자 핵심 불만: "취합본을 저장했는데 어드민 부서 조회에서 안 나온다" — admin/reports가 dept_weekly_reports를 안 읽음
- 멤버/어드민 취합 UI가 갈라지지 않도록 단일 컴포넌트(SSOT) 재사용 (재사용·단일구현 정책)

## 완료조건
- [ ] 어드민에서 AX사업본부 선택 조회 시 멤버가 저장한 취합본(body)이 상단에 표시
- [ ] 취합본 아래 원본 멤버 보고(raw)가 접이식으로 병행 표시
- [ ] 어드민이 전 부서(본인 부서장 아니어도) 재취합 가능 (admin 바이패스)
- [ ] confirmed 취합본 재취합 시 경고 모달 → 진행 시 draft로 저장
- [ ] 멤버 화면 취합본과 어드민 취합본이 동일 데이터·동일 UI (SSOT)
- [ ] tsc·lint·design guard·테스트 통과, 🟥 DC-SEC(권한 바이패스)·🟥 DC-REV PASS
- [ ] Playwright 실화면: 어드민 AX 조회 → 취합본 노출 확인

## 제외
- 취합 AI 알고리즘(mergeAndRefineByCategory) 변경, DB 스키마 변경(기존 dept_weekly_reports 재사용)
