# 03 · 작업 분해 (Phase 로드맵)

> DC-BIZ 권고: P1+P2까지 우선, P3·P4는 P2 8주 정착 후 재평가. 과설계 금지.

## Phase 1 — 권한 인프라 (UX 영향 0, 가장 꼼꼼히)
> 사용자에게 보이는 변화 없음. 모든 후속의 기반.
- [ ] `org_node_closure` 테이블 + 인덱스 + FK(cascade)
- [ ] closure 동기화 트리거 3종(INSERT/UPDATE-move/BEFORE-cycle-guard) + 기존 데이터 백필
- [ ] `org-chart/actions.ts`의 create/move/delete가 트리거와 정합되는지 검증(클라이언트 사이클체크 → DB로 승격)
- [ ] 뷰 `v_user_departments`, `v_user_managed_nodes`
- [ ] `private` 스키마 + 헬퍼함수(`my_readable_dept_ids`/`my_editable_dept_ids`/`is_executive`) — plpgsql·SECURITY DEFINER·search_path=''
- [ ] closure 직접접근 revoke
- [ ] 부서장 미지정/공석 경고를 조직도 관리 UI에 노출(데이터 정합성)
- [ ] 단위테스트: 트리 이동/삭제 후 closure 정합성, 헬퍼함수 권한 집합 정확성

## Phase 2 — 주간보고 격리 적용 (핵심 가치, 단계 롤아웃)
- [ ] `weekly_reports`에 `department_id`(작성시점 동결) + 업서트 RPC에서 채움
- [ ] 피처플래그 `weekly_report_hierarchy_enabled`(system_settings)
- [ ] **Shadow(2주)**: RLS 기존 유지 + "가시 대상" 메타 UI 표기 → 데이터 정확성·부서장 지정 점검
- [ ] **Soft(2주)**: 격리 RLS 적용 + "전체보기" 토글(로그) → 횡적 수요 측정
- [ ] **Hard**: 토글 제거, 정책 확정
- [ ] 팀원 화면: "우리 부서 취합" 조회 전용 탭
- [ ] 롤백 절차 문서화 + 리허설(정책 swap 30분 내)

## Phase 3 — 부서장 취합 + 계층 뷰 (사용자화면 이관)
- [ ] `dept_weekly_reports` 테이블 + RLS(읽기=readable, 쓰기=editable)
- [ ] 부서장 "우리 부서" 탭: 원본목록 → AI취합(`mergeAndRefineByCategory` 재사용) → 편집기 → 확정(스냅샷)
- [ ] `source_hash`로 "재취합 필요" 감지
- [ ] 상위 부서장 "조직 현황" 탭: `OrgScopeTree` + `DeptReportView`(조회전용)
- [ ] 대표이사 `CompanyDashboard`(부서카드 그리드 + 드릴다운 + 전체펼침)
- [ ] `report_access_log` 감사 기록
- [ ] 어드민 `/admin/reports` 취합 → 사용자화면 이관(병행 후 제거)

## Phase 4 — 캘린더 등 확장 (요구 검증 후 선택)
- [ ] `calendar_events.department_id` + 동일 헬퍼함수 RLS 재사용
- [ ] 캘린더 가시성 매트릭스 적용
- [ ] (필요 시) 문서/결재/KPI로 동일 RBAC 패턴 일반화

## 의존성 그래프
```
P1(클로저·뷰·함수) ─┬─▶ P2(주간보고 격리) ─▶ P3(취합·계층뷰) ─▶ P4(캘린더)
                    └─ 피처플래그/롤백은 P2 진입 전 준비
```

## 모델 배정(구현 시)
- 🟩 DC-DEV-DB: 클로저·트리거·뷰·RLS·헬퍼함수 (P1 핵심)
- 🟩 DC-DEV-BE: 취합 액션·RPC·감사로그·피처플래그
- 🟩 DC-DEV-FE: OrgScopeTree·DeptReportEditor/View·CompanyDashboard
- 🟥 DC-SEC: RLS 우회·격리 누수·재귀/성능 검증 (게이트)
- 🟥 DC-QA: 권한 매트릭스 시나리오 테스트
