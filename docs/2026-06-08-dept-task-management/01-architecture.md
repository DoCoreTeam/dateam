# 부서 업무 관리 — 아키텍처 설계서 (기획)

> 2026-06-08 · 구현 0. 모든 SQL/타입은 **설계 예시**이며 적용하지 않는다.
> 근거: 🟦 DC-ANA 재사용맵 · 🟦 DC-RES 패턴 · 🟦 DC-BIZ MVP.

## 0. 재사용 맵 요약 (🟦 DC-ANA, 코드 근거)

| 기존 자산 | 위치 | 부서업무 용도 | 분류 |
|------|------|------|------|
| `entry_type`(done/doing/planned/blocker/note) | daily_logs | 업무 상태 | **재사용** |
| `priority`, `target_date`, `is_resolved` | daily_logs | 우선순위/마감/미완추적 | **재사용** |
| `parent_log_id`, `origin_group_id`+`groupDailyLogs()` | daily_logs/grouping.ts | 서브태스크/배치 | **재사용** |
| `private.my_readable_dept_ids/user_ids/editable/is_executive/hierarchy_enabled` | 046·047·050 | 부서 가시성/쓰기 RLS | **재사용(신규 함수 금지)** |
| `resolveOrgScope`/`deptMemberUserIds`/`hasOrgScope` | lib/org-scope.ts | 담당자 후보·권한 계산 | **재사용** |
| `DailyTaskSelector`+`/api/weekly-report/generate-from-tasks` | weekly-report | 주간보고 연동 | **재사용** |
| `daily_log_threads`+`ThreadView`+`addThread/getThreads` | 022·daily | 댓글 컨테이너/UI | **확장**(author_user_id + RLS 재작성) |
| `updateDailyLogStatus` | daily/actions.ts:264 | 상태/진행 갱신 | **확장**(progress 추가) |
| (없음) 담당자≠작성자 / department_id / progress / checklist | — | 부서업무 고유 | **신규 최소** |

## 1. 핵심 설계 결정 — D-1 (데이터 표현)

> **긴장**: 사용자는 "daily_logs 재사용, 새 프로세스 금지"를 지시. 그러나 🟦 DC-ANA 확인 결과 daily_logs는 `user_id = auth.uid()`(작성자=소유자)로 INSERT RLS가 고정돼 있고(010:34), 담당자·부서소유·진행률·체크리스트 컬럼이 전무. 그대로는 "타인에게 업무 지정"이 불가능.

### 옵션 ⓐ — daily_logs 확장 (재사용 최대)
- daily_logs에 `assignee_user_id`, `department_id`, `progress`, `task_kind` 컬럼 추가.
- `task_kind='dept_task'`인 행이 부서업무. 개인 일일업무는 `task_kind='personal'`(기본).
- 댓글=`daily_log_threads` 확장. 상태/우선순위/마감/이월/그룹핑/주간연동 **전부 기존 그대로**.
- 👍 재사용 극대화, 단일 daily/weekly 파이프라인 유지(사용자 지시에 가장 충실).
- 👎 daily_logs가 개인+부서 이중 목적 → RLS·UI 분기 복잡. INSERT RLS를 `assignee≠author` 허용하도록 완화 필요(개인 일일업무 보안에 영향 주지 않게 `task_kind`로 분기).

### 옵션 ⓑ — 얇은 신규 `dept_tasks` 테이블 (분리)
- `dept_tasks` 독립 테이블 + 담당자 진행은 **담당자의 daily_logs를 task에 링크**(재사용).
- 👍 개인/부서 깔끔 분리, RLS 단순(🟦 DC-RES·DC-BIZ 선호).
- 👎 "완전 새 프로세스 금지" 지시와 인접 — 단, 프로세스(일일기록·주간연동·org권한)는 재사용하므로 "새 테이블 1개"에 그침.

### ✅ 확정 (2026-06-08) — **옵션 ⓐ daily_logs 확장**
사용자 확정. daily_logs를 substrate로 쓰되 `task_kind`로 개인/부서를 명확히 구분하고, **UI·사이드바는 별 화면으로 분리**(00-요구사항 원칙4). 신규는 컬럼 4개 + 체크리스트 jsonb + 스레드 컬럼 1개로 최소화. ⓑ(신규 테이블)는 채택하지 않음.

> **D-2 확정**: 댓글은 `daily_log_threads` 확장 재사용(2.2). polymorphic `comments` 미채택.
> **D-3 확정**: 담당자(`assignee_user_id`) 지정/변경은 부서장(`my_editable_dept_ids`)·admin만. 부서원 등록 시 담당자=null 또는 본인만(3절 RLS 반영).

## 2. 데이터 모델 (옵션 ⓐ 기준 — 설계 예시, 미적용)

### 2.1 daily_logs 확장 (신규 컬럼 — 기존 행 영향 없음, 전부 nullable/기본값)
```
-- 설계 예시 (적용 금지)
alter table daily_logs
  add column task_kind        text not null default 'personal'
       check (task_kind in ('personal','dept_task')),
  add column assignee_user_id uuid references profiles(id),   -- 담당자(≠작성자 허용)
  add column department_id     uuid references org_nodes(id),  -- 부서 소유(weekly_reports 패턴)
  add column progress          int  not null default 0 check (progress between 0 and 100),
  add column checklist         jsonb not null default '[]';    -- [{label, done}] (선택)
```
- 상태=`entry_type` 재사용(planned/doing/blocker/done). 'note'는 부서업무에 미사용.
- 마감=`target_date` 재사용. 우선순위=`priority` 재사용. 미완추적=`is_resolved` 재사용.
- 서브태스크=`parent_log_id` 재사용. → **신규 테이블 0개**(체크리스트는 jsonb로 흡수 — 🟦 DC-RES 권고).

### 2.2 댓글 — D-2 결정
- **권고(사용자 지시 부합)**: `daily_log_threads` **확장** 재사용.
  ```
  alter table daily_log_threads
    add column author_user_id uuid references profiles(id),   -- "누가" 식별(현재 author_type만 존재)
    add column parent_thread_id uuid references daily_log_threads(id);  -- 대댓글 대비(MVP UI는 1-depth)
  ```
  - RLS 재작성 필수: 현재 "log.user_id=auth.uid()"(작성자 본인만) → "해당 부서업무를 볼 수 있는 사람(부서 가시성)이면 댓글 읽기, 본인 댓글만 수정/삭제".
- **대안(SSOT 중시)**: 범용 `comments(entity_type, entity_id, parent_id, author_id, body, deleted_at)` 신설(🟦 DC-RES/DC-BIZ). 향후 deal/contact 댓글까지 1테이블. 단 "새 테이블"이라 사용자 지시와 거리.
  → 권고: **MVP는 daily_log_threads 확장**(재사용), 폴리모픽 comments는 후속 SSOT 과제로 명시.

## 3. 권한/RLS 설계 (기존 함수 100% 재사용 — 신규 함수 금지)

🟦 DC-RES 패턴 + 046/050 원칙. `task_kind='dept_task'` 행에만 부서 규칙, `personal`은 기존 그대로.
```
-- SELECT: 개인행=기존 / 부서행=부서가시성
-- using ( task_kind='personal' AND user_id=auth.uid() ... 기존정책 그대로 )
--   OR  ( task_kind='dept_task' AND ( department_id = any(private.my_readable_dept_ids())
--          OR private.is_executive() OR assignee_user_id = auth.uid() OR user_id = auth.uid() ) )
-- INSERT(dept_task): department_id = any(private.my_editable_dept_ids())  -- 부서장
--   OR (부서원 등록 허용 시) department_id = any(private.my_readable_dept_ids()) AND assignee_user_id = auth.uid()
-- UPDATE/DELETE: assignee=auth.uid() OR user_id=auth.uid() OR department_id=any(my_editable_dept_ids()) OR admin
```
- **D-3 담당자 쓰기 제약(확정)**: 담당자=작성자(또는 비움)는 부서원도 가능하나, **`assignee_user_id`를 *타인으로* 지정/변경**하는 건 부서장(`my_editable_dept_ids`)·admin만. → 컬럼 단위 보호는 RLS만으로 어려우므로 **서버액션에서 강제**(assignee 변경 요청 시 editable 부서 검증) + 트리거 보조 검증 권장. 담당자 갱신은 단일 전용 액션(`assignTask`)으로 일원화.
- **계층 게이팅**: `private.hierarchy_enabled()`(v0.7.38 플래그) 동일 적용 — OFF면 부서업무도 본인/관할만, 일관.
- 재귀 방지: 권한 판정은 전부 `private.*` SECURITY DEFINER 함수로(046 원칙).
- ⚠️ INSERT RLS 완화는 **`task_kind` 분기로** — 개인 일일업무의 "본인만 작성" 보안을 절대 훼손하지 않도록.

## 4. 주간보고 연동 (재사용)

- **자동 집계 표시**: 주간보고 '조직 현황' 탭에서 해당 주 부서업무(진행/완료)를 `resolveOrgScope`로 가시 부서만 집계해 read-only 표시. (기존 OrgWeeklyView/TeamReportView 패턴 확장)
- **수동 인용**: `DailyTaskSelector` 재사용 — `task_kind='dept_task'`도 선택 후보에 포함, `generate-from-tasks` API에 동일하게 흘려 주간보고 텍스트로 인용.
- **단방향 원칙(🟦 DC-BIZ)**: 주간보고는 부서업무를 **표시/인용만**, 역으로 수정하지 않는다(양방향 동기화 금지).

## 5. UI 플로우 (화면 분리 — 원칙4)

- 사이드바 신규 항목 "부서 업무"(일일업무와 별도). MobileShell·page-inner·NbCard/NbButton·table-card 재사용(디자인시스템 v0.7.39 토큰 준수).
- 화면: ① 부서업무 리스트(상태 필터, 담당자/마감/진행률) → ② 상세(설명·체크리스트·상태/진행 갱신·댓글 스레드) → ③ 등록 모달(제목·담당자(=deptMemberUserIds 후보)·마감·우선순위·체크리스트 옵션).
- 댓글 UI = `ThreadView` 확장(작성자 아바타/이름 표시, 1-depth).

## 6. 실시간/갱신 (🟦 DC-RES 권고)

- 기본: 기존 **SWR `mutate()` 낙관적 업데이트**(본인 상태변경/댓글 즉시 반영). 추가 의존성 0.
- 선택: 댓글 INSERT만 Supabase Realtime을 `entity_id` 단일 필터로 구독해 mutate 트리거(전체 테이블 구독 금지). MVP는 `revalidateOnFocus`로도 충분 → Realtime은 후속.

## 7. 신규/재사용/확장 경계 (한눈)

- **재사용(그대로)**: org-scope·private 함수·계층플래그·entry_type/priority/target_date/is_resolved/parent_log_id·grouping·DailyTaskSelector·SWR.
- **확장(컬럼/정책 추가)**: daily_logs(+4컬럼,+jsonb)·daily_log_threads(+author_user_id,+parent)·RLS 정책·updateDailyLogStatus·ThreadView.
- **신규(최소)**: 부서업무 리스트/상세/등록 화면 + 사이드바 1항목. 신규 테이블 **0개**(ⓐ안 기준).
