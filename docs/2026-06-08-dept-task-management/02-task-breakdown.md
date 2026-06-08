# 부서 업무 관리 — 작업 분해 (기획)

> 2026-06-08 · **구현 0**. 아래는 향후 구현 시 작업 순서 제안일 뿐, 지금 실행하지 않는다.
> 옵션 ⓐ(daily_logs 확장) 기준. ⓑ 선택 시 S1을 `dept_tasks` 신설로 치환.

## 스프린트 0 — 사용자 확정 ✅ (2026-06-08 완료)
- T0.1 D-1 = **ⓐ daily_logs 확장** (신규 테이블 0)
- T0.2 D-2 = **daily_log_threads 확장** (polymorphic comments 보류)
- T0.3 담당자 지정/변경 = **부서장만**(부서원 등록은 가능, assignee는 본인/비움) → 전용 `assignTask` 액션으로 일원화
- ✔ 결정 확정 → S1 진입 가능

## 스프린트 1 — 데이터/RLS ✅ 완료 (2026-06-08, v0.7.47 / `075_dept_task_management.sql` 적용)
- daily_logs +5컬럼·daily_log_threads +2컬럼, RLS 4+4 정책 재작성, 운영 적용·검증 완료.
- 검증: 개인로그 무회귀(2팀장이 1팀원 개인업무 차단) + 부서업무 매트릭스(1팀↔2팀 격리) + 댓글 격리 + 브라우저 /daily 정상.
- 🟥 DC-SEC PASS-WITH-NOTES. **S2 보강 필요(잔여)**:
  - assignee 무결성: assignee_user_id가 해당 부서 소속 person인지 트리거/서버액션 검증(D-3 컬럼레벨은 assignTask 액션에서 강제).
  - dlt_insert admin 분기 추가 여부 결정(현재 admin은 타 로그 댓글 불가 — 의도면 유지).
  - checklist jsonb 구조 검증 + 프런트 sanitize(XSS), parent_thread_id 동일 log_id 제약.

### (구) 스프린트 1 작업 목록 — 데이터/RLS (Backend·DB)
- T1.1 daily_logs 확장 컬럼 마이그레이션 작성(task_kind/assignee_user_id/department_id/progress/checklist) — 전부 기본값, 기존행 무영향
- T1.2 daily_log_threads 확장(author_user_id, parent_thread_id) 마이그레이션
- T1.3 RLS 정책 재작성: daily_logs SELECT/INSERT/UPDATE/DELETE를 task_kind 분기(개인 보안 불변 보장)
- T1.4 daily_log_threads RLS 재작성(부서 가시성 읽기 / 본인 댓글만 수정)
- T1.5 `private.hierarchy_enabled()` 게이팅을 부서업무 정책에 연결
- ✔ 완료기준: RLS 시뮬레이션 매트릭스(부서장/부서원/타부서/임원) 통과 — 이전 v0.7.38 검증 하네스 재사용

## 스프린트 2 — 서버 로직 (Backend)
- T2.1 부서업무 CRUD 서버액션(생성, 상태/진행 갱신은 updateDailyLogStatus 확장) + **`assignTask` 전용 액션(담당자 지정/변경 — 부서장·admin만, editable 부서 검증)**
- T2.2 댓글 CRUD(addThread/getThreads 확장 — author_user_id 포함)
- T2.3 담당자 후보 목록 = `deptMemberUserIds(resolveOrgScope)` 재사용 API
- T2.4 부서업무 목록 조회(상태 필터, 가시 부서 범위)
- ✔ 완료기준: 각 액션 단위테스트 + 권한 경계 테스트 통과

## 스프린트 3 — UI (Frontend)
- T3.1 사이드바 "부서 업무" 항목 추가(MobileShell, 일일업무와 분리)
- T3.2 리스트 화면(상태 필터/담당자/마감/진행률 — table-card, NbCard 재사용)
- T3.3 상세 화면(설명·체크리스트·상태/진행 갱신·댓글 ThreadView 확장)
- T3.4 등록 모달(제목·담당자 select·마감·우선순위·체크리스트 옵션)
- T3.5 SWR mutate 낙관적 업데이트 연결
- ✔ 완료기준: 디자인토큰(`pnpm design:check`) 통과 + 반응형(320/768/1024/1440) 무overflow

## 스프린트 4 — 주간보고 연동 (Frontend+Backend)
- T4.1 주간보고 '조직 현황'에 부서업무 자동 집계 섹션(read-only)
- T4.2 DailyTaskSelector에 dept_task 후보 포함(수동 인용)
- T4.3 단방향 보장(주간보고→부서업무 쓰기 차단) 확인
- ✔ 완료기준: 부서장 계정 E2E로 자동집계+인용 동작 확인

## 스프린트 5 — 검증/마감
- T5.1 Playwright E2E(부서장/부서원 다층 시나리오 — v0.7.38 하네스 패턴 재사용)
- T5.2 RLS 보안 리뷰(🟥 DC-SEC)
- T5.3 성공지표 측정 쿼리 3종 작성
- ✔ 완료기준: 04-completion-criteria.md 전 항목 ✅

## 의존 그래프
S0 → S1 → S2 → S3 → (S4 ∥ S5의 T5.1). S1의 RLS가 전체 게이트.

## 규모/리스크 메모
- 신규 테이블 0(ⓐ) → 마이그레이션 리스크 낮음. 최대 리스크 = **RLS 재작성이 개인 일일업무 보안에 회귀**를 내지 않는 것(T1.3 분기 검증 필수).
- 협업툴 scope creep 차단: S 이후 멘션/알림/칸반은 별도 기획.
