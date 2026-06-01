# 01 · 아키텍처 — 권한 모델 & 데이터 설계

> 기획 전용. 아래 모든 SQL/스키마는 **설계 청사진**이며 적용하지 않는다.

## A. 전체 그림

```
                 ┌──────────────────────────────────────────┐
   진실 소스 ──▶ │  org_nodes (company/role/department/person) │  ← 조직도 (기존, 유지)
                 │   parent_id 인접리스트 · head_user_id        │
                 └──────────────────────────────────────────┘
                              │ 트리거로 자동 동기화
                              ▼
                 ┌──────────────────────────────────────────┐
   권한 인덱스 ─▶│  org_node_closure (ancestor,descendant,depth)│  ← 신규 (계층 평탄화)
                 └──────────────────────────────────────────┘
                              │ SECURITY DEFINER 함수가 참조
                              ▼
   권한 API ───▶  private.* 헬퍼함수 (can_read/can_edit/managed_ids)
                              │ RLS 정책이 호출
            ┌─────────────────┼──────────────────────────────┐
            ▼                 ▼                               ▼
     weekly_reports     dept_weekly_reports             (calendar_events)
     (개인 원본·기존)    (부서 취합 스냅샷·신규)           (2차 적용·동일 패턴)
```

**원칙**: 권한의 *하한선*은 RLS(DB)가 보장하고, *계층 로직*은 `private` 스키마의 `LANGUAGE plpgsql SECURITY DEFINER` 함수에 캡슐화한다. 이렇게 하면 ① API 우회/직접 쿼리에도 안전 ② migration 003에서 겪은 RLS 무한 재귀를 원천 차단.

## B. 조직 계층 — Closure Table (D1)

### B-1. 스키마
```sql
-- 설계안 (적용 금지)
create table org_node_closure (
  ancestor_id   uuid not null references org_nodes(id) on delete cascade,
  descendant_id uuid not null references org_nodes(id) on delete cascade,
  depth         int  not null,                 -- 0 = 자기 자신
  primary key (ancestor_id, descendant_id)
);
create index idx_closure_ancestor   on org_node_closure (ancestor_id);
create index idx_closure_descendant on org_node_closure (descendant_id);
-- authenticated 직접 접근 차단 → 오직 SECURITY DEFINER 함수로만 참조
revoke all on org_node_closure from anon, authenticated;
```

### B-2. 트리거로 자동 유지 (인접리스트 → 클로저)
- **INSERT**: 자기행(depth0) + (부모의 모든 조상 → 새 노드) 삽입.
- **UPDATE OF parent_id (이동)**: ① 서브트리↔외부조상 경로 삭제 → ② 새 부모의 조상 × 이동 서브트리 전체 재삽입. (Bill Karwin "moving subtrees" 패턴 — DC-RES 검증)
- **BEFORE UPDATE**: 자기 자손 아래로 이동 시 `RAISE EXCEPTION`(사이클 방지). 기존 `moveNode` 액션의 클라이언트 사이클 체크를 DB로 승격.
- **DELETE**: closure FK `on delete cascade`로 자동.
- **백필**: 기존 `org_nodes` 전체에 대해 1회 재귀 CTE로 closure 초기 적재(트리거는 이후 증분만).

> 트리거는 `org_nodes` 쓰기 경로(`admin/org-chart/actions.ts`의 create/move/delete)에 투명하게 작동 — 기존 액션 코드 변경 최소.

### B-3. 대안 기각 근거 (DC-RES)
| 방식 | 기각 사유 (이 규모) |
|------|--------------------|
| WITH RECURSIVE in RLS | RLS 내 재귀 → PostgREST JOIN 시 행마다 재귀 플랜, 003 재귀 악몽 재현 위험 |
| ltree / materialized path | 이동 시 서브트리 전체 path UPDATE, 수백만 노드급에서나 이득 — 과설계 |
| **closure table** | 읽기≫쓰기인 조직도에 최적, RLS는 단순 JOIN, 수백명=최대 수만 행(무시 가능) → **채택** |

## C. 소속·부서장 정규화 — 뷰 (D2)

`profiles.department_id`를 추가하지 **않는다**(이중 소스 회피). 대신 `org_nodes`에서 파생 뷰로 정규화:

```sql
-- 설계안. user_id → 직접 소속 부서 노드
create view v_user_departments as
select p.user_id, p.parent_id as department_id
from org_nodes p
where p.type = 'person' and p.user_id is not null;

-- user_id → 본인이 head인 부서 노드(겸직 = 복수행)
create view v_user_managed_nodes as
select head_user_id as user_id, id as department_id
from org_nodes
where head_user_id is not null and type in ('department','role');
```

**부서장 단일화 규칙(canonical)**: "부서장 여부"는 `org_nodes.head_user_id`만으로 판정한다. role노드-첫-person fallback(현 UI 표시용)은 **권한 판정에 쓰지 않는다**. → 조직도 관리 화면에서 부서장 미지정 부서를 경고/차단(운영 데이터 정합성).

## D. 권한 헬퍼 함수 (SECURITY DEFINER · plpgsql)

> `LANGUAGE sql` 금지(인라이닝으로 SECURITY DEFINER 무력화). `set search_path=''`, `STABLE`, `(select auth.uid())` 캐싱 필수 — DC-RES.

```sql
-- 내가 관할(=조회 가능)하는 모든 부서노드 id 배열 (자기부서 + 하위 전체)
create function private.my_readable_dept_ids() returns uuid[]
language plpgsql stable security definer set search_path='' as $$
begin
  return array(
    select distinct c.descendant_id
    from public.org_node_closure c
    where c.ancestor_id in (              -- 내가 head인 부서들의
      select id from public.org_nodes where head_user_id = (select auth.uid())
    )
    union
    select department_id from public.v_user_departments where user_id = (select auth.uid())
  );
end; $$;

-- 내가 편집/취합 가능한 부서노드 id 배열 (자기부서 = 내가 직접 head, depth 0)
create function private.my_editable_dept_ids() returns uuid[]
language plpgsql stable security definer set search_path='' as $$
begin
  return array(
    select id from public.org_nodes where head_user_id = (select auth.uid())
  );
end; $$;

-- 대표이사/전사 권한 여부 (최상위 company/role head)
create function private.is_executive() returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  return exists(
    select 1 from public.org_nodes n
    where n.head_user_id = (select auth.uid())
      and n.parent_id is null      -- 최상위
  );
end; $$;
```

**성능 패턴(DC-RES)**: RLS에서 행마다 함수 호출 대신 **배열을 한 번 만들어 `= ANY(ARRAY(select fn()))`**. Supabase 벤치마크상 173,000ms→3ms.

### D-bis. 멀티부서 대시보드용 — 노드 상대 조회 (★ 1:N 일반화)
> 대시보드는 대표이사 전용이 아니라 **자식 부서 ≥2를 가진 모든 노드**에 적용된다(요구 수정). RLS·헬퍼는 이미 이를 지원하므로 **새 권한 로직 불필요** — UI가 "선택 노드의 직속 자식 부서"를 그리기만 하면 된다.

```sql
-- 내 관할 최상위 노드(들): readable 집합 중 조상이 readable에 없는 노드 = 대시보드 시작점
-- (대표=전사 루트, 본부장=자기 본부, 실장=자기 실 …)
create function private.my_scope_roots() returns uuid[]
language plpgsql stable security definer set search_path='' as $$
begin
  return array(
    select id from public.org_nodes
    where head_user_id = (select auth.uid())
      and (parent_id is null
           or parent_id <> all(
             select id from public.org_nodes where head_user_id = (select auth.uid())
           ))
  );
end; $$;

-- 특정 노드의 직속 자식 부서 + 각 자식의 취합 진척(대시보드 카드 데이터)
-- depth=1 자식만(드릴다운은 클릭 시 다음 depth 재귀 호출)
select child.id, child.name,
       (select count(*) from weekly_reports wr
          join org_node_closure c on c.descendant_id = wr.department_id
         where c.ancestor_id = child.id) as report_count,
       dwr.status as agg_status
from org_node_closure pc
join org_nodes child on child.id = pc.descendant_id and child.type = 'department'
left join dept_weekly_reports dwr on dwr.department_id = child.id and dwr.week_start = $week
where pc.ancestor_id = $node_id and pc.depth = 1;
```

**분기 규칙(역할 하드코딩 금지)**: `직속 자식 부서 수`로 화면 결정 — ≥2 → 카드 그리드 / =1 → 단일 취합본 / =0 → 잎(자기 부서 취합본). 드릴다운은 자식 노드 id로 동일 쿼리를 **재귀** 호출. 따라서 본부장·실장·대표이사가 **하나의 `ScopeDashboard` 컴포넌트 + 하나의 쿼리**를 scope만 바꿔 공유한다.

## E. 주간보고 데이터 모델 (D3 — 스냅샷 영속)

### E-1. 개인 원본: `weekly_reports` (기존 유지 + 소속 동결)
보고서에 **작성 시점 부서 동결** 컬럼 추가(조직 이동/개편 시 소급 가시성 문제 차단 — DC-BIZ):
```sql
alter table weekly_reports
  add column department_id uuid references org_nodes(id),   -- 작성 시점 소속(스냅샷)
  add column dept_path_snapshot text;                        -- 조직개편 대비 경로 보존(선택)
```
- 작성/업서트(`replace_weekly_report` RPC) 시 `v_user_departments`로 현재 소속을 채워 동결.

### E-2. 부서 취합 스냅샷: `dept_weekly_reports` (신규)
```sql
create table dept_weekly_reports (
  id           uuid primary key default gen_random_uuid(),
  department_id uuid not null references org_nodes(id),
  week_start   date not null check (extract(dow from week_start)=1),
  body         jsonb not null,        -- category별 취합 본문(부서장 편집 가능)
  source_hash  text,                  -- 원본 N건 기준 해시(재취합 필요 감지)
  status       text not null default 'draft' check (status in ('draft','confirmed')),
  edited_by    uuid references profiles(id),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (department_id, week_start)
);
```
- 부서장이 "취합" 실행 → 부서원 원본 N건을 AI 병합(`mergeAndRefineByCategory` 재사용) → `dept_weekly_reports`에 스냅샷 저장(편집 가능, draft→confirmed).
- 상위 부서장/대표이사는 하위 `dept_weekly_reports`를 **조회 전용**.

## F. RLS 정책 설계 (요지)

```sql
-- weekly_reports(개인 원본)
-- SELECT: 본인 OR 그 보고서 부서가 내 readable 집합에 속함 OR 전사
create policy wr_select on weekly_reports for select to authenticated using (
  user_id = (select auth.uid())
  or department_id = any((select private.my_readable_dept_ids()))
  or (select private.is_executive())
);
-- INSERT/UPDATE/DELETE: 본인만 (기존 유지)
create policy wr_write on weekly_reports for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- dept_weekly_reports(취합 스냅샷)
-- SELECT: readable 부서집합 OR 전사
create policy dwr_select on dept_weekly_reports for select to authenticated using (
  department_id = any((select private.my_readable_dept_ids()))
  or (select private.is_executive())
);
-- INSERT/UPDATE: editable(자기부서) 만 → 하위부서는 조회전용 강제
create policy dwr_write on dept_weekly_reports for all to authenticated
  using (department_id = any((select private.my_editable_dept_ids())))
  with check (department_id = any((select private.my_editable_dept_ids())));
```

> 이 정책이 요구사항 6번("편집·취합은 자기 부서만, 하위는 조회전용")을 **DB에서 강제**한다. `my_editable_dept_ids`는 depth0(직접 head)만 반환하므로 하위 부서 write는 구조적으로 불가.

## G. 피처플래그 & 롤아웃 게이트 (DC-BIZ)
```
weekly_report_hierarchy_enabled  (org 전역 ON/OFF, system_settings)
  Shadow: RLS는 기존(전원열람) 유지 + "이 보고서 가시 대상" 메타만 UI 표기
  Soft  : 격리 RLS 적용 + "전체보기" 토글(로그 기록)
  Hard  : 토글 제거, 정책 확정
롤백: 정책 swap 1회로 전원열람 복귀(30분 내)
```

## H. 캘린더 적용(2차 — 원칙만, D4)
- `calendar_events`에도 `department_id`(주최 부서) 동결 + 동일 헬퍼함수 RLS 재사용.
- 가시성 매트릭스는 주간보고와 동일: 본인/자기부서 편집, 상위 조회, 전사 조망.
- 상세 컴포넌트는 본 기획 범위 외(P4).

## I. 감사 로그
```sql
create table report_access_log (
  id uuid primary key default gen_random_uuid(),
  viewer_id uuid, target_kind text, target_id uuid,
  department_id uuid, accessed_at timestamptz default now()
);
```
- 상위 부서장/대표이사의 하위 보고서 열람 시 기록(append-only, admin SELECT).
