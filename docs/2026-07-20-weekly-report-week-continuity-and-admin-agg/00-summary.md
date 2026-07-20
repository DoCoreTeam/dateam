# 주간보고 — 주차 연속성 + 어드민 취합 진입 UX (분석·기획, 구현 금지)

> 2026-07-20 · 🟦 DC-ANA ×2. **분석/기획만. 구현 별도.**

## 공통 뿌리 (핵심)
두 결함 모두 **"부서별 취합/주차 상태를 보는 SSOT가 조직현황(member)엔 있는데, 팀뷰·어드민이 재사용하지 않고 각자 부분 구현"** 한 데서 나온다. 한 번 공용화하면 둘 다 해결된다.

---

## 이슈 A — 주차(week)가 탭 이동 시 리셋됨

### 근본원인
weekly-report 3개 뷰가 주차를 **제각각** 들고 있고, 탭이 순수 `<Link>`라 탭 전환 = 서버 컴포넌트 재실행 = 하위 컴포넌트 remount → useState 초기값(=최신주 thisWeek)으로 복귀.
| 뷰 | 주차 소스 | URL 반영 |
|---|---|---|
| WeeklyReportForm(내 보고) | `useState(initialWeek)` + `?editWeek=`, 단 select 변경은 URL 미반영 + `key=initialWeek` remount | 부분 |
| TeamReportView(팀 전체) | `useState(thisWeek)` — **URL 전혀 안 씀** | **없음** |
| OrgWeeklyView(조직 현황) | props `weekStart` ← `?orgWeek=`, 이전/다음주가 `<Link ?orgWeek=>` | **완전(유일한 정답 패턴)** |
→ TeamReportView는 무조건 최신주 리셋, Form은 저장 안 하면 유실. **OrgWeeklyView만 URL-as-state 컨벤션을 지키고 나머지 둘이 이탈**한 게 갭.

### 재설계 방향
- **단일 `?week=` 파라미터로 통일**(`editWeek`/`orgWeek` 통합). 탭 `<Link>` href에 현재 week를 항상 실어 전환에도 유지.
- **상단 공용 WeekPicker를 탭 옆(헤더)에 1개** — 사용자가 말한 "전역으로 탭 옆에 표시"와 정확히 일치. 세 뷰는 이 `?week=`만 소비(각자 `<select>` 중복 제거). onChange=`router.replace(?week=)`.
- Zustand 등 클라 전역스토어는 **비권장**(프로젝트가 URL-as-state 채택, 새로고침·공유·북마크에 견고).
- 핵심 파일: `weekly-report/page.tsx`·`WeeklyReportForm.tsx:83,258`·`TeamReportView.tsx:27`(미배선)·`OrgWeeklyView.tsx`(이식할 SSOT)·`WorkSubTabs.tsx:38-50`(탭 href에 week 추가).

## 이슈 B — 어드민 취합 첫 진입 시 "취합완료 부서" 미표시

### 근본원인
`admin/reports/page.tsx`가 취합 상태(`dept_weekly_reports.status`)를 **선택된 부서 1개만** `.eq('department_id', dept)`로 단건 조회. 전 부서 집계 쿼리가 **아예 없음**(lazy가 아니라 "안 만듦"). 부서 선택 전엔 부서별 취합 상태 UI가 코드에 없어 빈 화면처럼 보임.
→ 정작 **"부서 리스트 + 취합완료 뱃지 + 제출 N/M"을 만드는 로직·컴포넌트가 조직현황(member)에 이미 SSOT로 존재**: `weekly-report/page.tsx:187-224`(orgDeptStats 일괄 `IN(...)` 조회) + `OrgWeeklyView.tsx:142-165`(카드 그리드 `aggBadge`) + `DeptReportPanel.tsx:33`(`aggBadge`/`AggState`). 어드민이 이걸 재사용 안 하고 단일선택 UI만 재구현.

### 재설계 방향 (추가 마이그레이션 불필요 — 기존 데이터로 즉시 가능)
- 부서 미선택 시 member 패턴대로 `dept_weekly_reports`를 `department_id IN(전체 부서)` 일괄 조회 → `deptStats` 계산 → **OrgWeeklyView 카드 그리드(`aggBadge`+제출 N/M) 그대로 import 재사용**(신규 자작 금지, SSOT).
- 상단 "취합완료 N / 전체 M부서" 요약 배지. select optgroup에도 취합완료 ✓.
- **정시/지연(timeliness) 배지 병행**(이미 `timeliness-server.ts`·OrgWeeklyView가 같은 카드에 표시) → 어드민 카드에 "취합완료 + 지연여부" 동시.
- 어드민은 전 조직 스코프(readableDeptIds 제약 불요 — 전체 노출이 맞음).

---

## 놓치기 쉬운 것 (확장)
- **M1. 두 이슈는 교차한다**: `?week=`가 공용화되면 어드민 취합 첫 화면도 "연속된 그 주차"의 취합상태를 보여줘야 일관. 어드민 reports도 같은 week 파라미터 컨벤션에 편입.
- **M2. 유실0 충돌**: Form은 week 변경 시 `key` remount로 **미저장 입력이 사라진다**. 주차 연속성 재설계가 이걸 건드리면 [[project_weekly_report_zero_loss_plan]] 정책과 충돌 — "다른 주차로 전환 = 다른 보고서라 리셋이 맞다"지만, **미저장 경고/스냅샷**을 붙여야 안전.
- **M3. "전역"의 경계**: member `(member)/weekly-report` 탭群과 `admin/reports`는 라우트 트리가 다르다. 진짜 크로스-레이아웃 전역 주차는 과함 — **weekly-report 탭 그룹 내 공유**로 스코프하고 어드민은 자체 `?week=`로 정합. (member↔admin 자동 동기화는 스코프·권한 달라 비권장)
- **M4. editWeek vs orgWeek 의미 병합 주의**: editWeek="작성 대상 주" / orgWeek="열람 주" — 개념상 같은 "현재 보는 주"라 병합 OK. 단 Form의 remount(key) 동작은 유지해야(주차 바뀌면 그 주 보고서 로드).
- **M5. 성능**: 어드민 일괄 집계는 `IN()` 1쿼리(member가 이미 실증) — N+1 없음. 문제 없음.
- **M6. 빈/로딩/에러 3종**: 어드민 첫 화면이 지금 "빈 화면" → 재설계로 카드 그리드가 채워짐. 부서 0개/쿼리 실패 상태도 명시 설계 필요.

## 결정 필요
- D1. 주차 전역 범위: weekly-report 탭 그룹 내 공유(권장) vs member↔admin 크로스.
- D2. WeekPicker 위치: 탭 옆 헤더 공용(권장) vs 각 뷰 유지+URL만 통일.
- D3. 어드민 취합 첫 화면: OrgWeeklyView 카드 재사용(권장) vs 경량 리스트+뱃지.
- D4. Form 주차변경 시 미저장 보호(M2): 경고 모달 vs 자동 스냅샷 vs 그대로(현행).
