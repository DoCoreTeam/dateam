-- 046_org_closure_permissions.sql
-- Phase 1 — 조직도 기반 계층 권한 인프라 (가산적·기존 데이터 미변경)
-- 기획: docs/2026-06-01-v0.6.4-org-permission-weekly/01-architecture.md
-- org_nodes(parent_id 인접리스트) → org_node_closure(평탄화) + private 헬퍼함수
-- RLS 재귀 회피: 모든 권한 판정은 private 스키마의 plpgsql SECURITY DEFINER 함수에 캡슐화.

-- ───────────────────────────── 1. Closure Table ─────────────────────────────
create table if not exists org_node_closure (
  ancestor_id   uuid not null references org_nodes(id) on delete cascade,
  descendant_id uuid not null references org_nodes(id) on delete cascade,
  depth         int  not null,
  primary key (ancestor_id, descendant_id)
);
create index if not exists idx_org_closure_ancestor   on org_node_closure (ancestor_id);
create index if not exists idx_org_closure_descendant on org_node_closure (descendant_id);

-- authenticated/anon 직접 접근 차단 → 오직 SECURITY DEFINER 함수로만 참조
alter table org_node_closure enable row level security;
revoke all on org_node_closure from anon, authenticated;

-- ───────────────────────────── 2. 동기화 트리거 ─────────────────────────────
-- 2-1. INSERT: 자기행(depth0) + (부모의 모든 조상 → 새 노드)
create or replace function fn_org_closure_after_insert()
returns trigger language plpgsql as $$
begin
  insert into org_node_closure (ancestor_id, descendant_id, depth)
  values (new.id, new.id, 0)
  on conflict do nothing;

  if new.parent_id is not null then
    insert into org_node_closure (ancestor_id, descendant_id, depth)
    select c.ancestor_id, new.id, c.depth + 1
    from org_node_closure c
    where c.descendant_id = new.parent_id
    on conflict do nothing;
  end if;
  return new;
end; $$;

drop trigger if exists trg_org_closure_insert on org_nodes;
create trigger trg_org_closure_insert
after insert on org_nodes
for each row execute function fn_org_closure_after_insert();

-- 2-2. BEFORE UPDATE: 사이클 방지(자기 자손 아래로 이동 차단)
create or replace function fn_org_closure_before_update()
returns trigger language plpgsql as $$
begin
  if new.parent_id is not null
     and new.parent_id is distinct from old.parent_id then
    if exists (
      select 1 from org_node_closure
      where ancestor_id = new.id and descendant_id = new.parent_id
    ) then
      raise exception 'org_nodes: 자기 자손(%) 아래로 이동할 수 없습니다', new.parent_id;
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_org_closure_before_update on org_nodes;
create trigger trg_org_closure_before_update
before update of parent_id on org_nodes
for each row execute function fn_org_closure_before_update();

-- 2-3. AFTER UPDATE OF parent_id: 서브트리 이동 재배선
create or replace function fn_org_closure_after_update()
returns trigger language plpgsql as $$
begin
  if not (new.parent_id is distinct from old.parent_id) then
    return new;
  end if;

  -- (a) 이동 서브트리 ↔ 외부 조상 경로 삭제 (서브트리 내부 경로 보존)
  delete from org_node_closure
  where descendant_id in (
          select descendant_id from org_node_closure where ancestor_id = new.id
        )
    and ancestor_id in (
          select ancestor_id from org_node_closure
          where descendant_id = new.id and ancestor_id <> descendant_id
        );

  -- (b) 새 부모의 조상 × 이동 서브트리 전체 경로 삽입
  if new.parent_id is not null then
    insert into org_node_closure (ancestor_id, descendant_id, depth)
    select super.ancestor_id, sub.descendant_id, super.depth + sub.depth + 1
    from org_node_closure super
    cross join org_node_closure sub
    where super.descendant_id = new.parent_id
      and sub.ancestor_id = new.id
    on conflict do nothing;
  end if;
  return new;
end; $$;

drop trigger if exists trg_org_closure_after_update on org_nodes;
create trigger trg_org_closure_after_update
after update of parent_id on org_nodes
for each row execute function fn_org_closure_after_update();

-- ───────────────────────────── 3. 백필 (기존 노드) ─────────────────────────────
with recursive tree as (
  select id as ancestor_id, id as descendant_id, 0 as depth from org_nodes
  union all
  select t.ancestor_id, n.id, t.depth + 1
  from tree t
  join org_nodes n on n.parent_id = t.descendant_id
)
insert into org_node_closure (ancestor_id, descendant_id, depth)
select ancestor_id, descendant_id, depth from tree
on conflict do nothing;

-- ───────────────────────────── 4. 정규화 뷰 ─────────────────────────────
-- user_id → 직접 소속 부서 노드
create or replace view v_user_departments as
select p.user_id, p.parent_id as department_id
from org_nodes p
where p.type = 'person' and p.user_id is not null and p.parent_id is not null;

-- user_id → 본인이 head인 부서/역할 노드 (겸직 = 복수행)
create or replace view v_user_managed_nodes as
select head_user_id as user_id, id as department_id
from org_nodes
where head_user_id is not null and type in ('department','role','company');

-- ───────────────────────────── 5. private 헬퍼함수 ─────────────────────────────
create schema if not exists private;

-- 내가 조회 가능한 부서노드 id 배열 (내가 head인 노드들의 서브트리 전체 + 내 소속부서)
create or replace function private.my_readable_dept_ids()
returns uuid[] language plpgsql stable security definer set search_path = '' as $$
begin
  return array(
    select distinct c.descendant_id
    from public.org_node_closure c
    where c.ancestor_id in (
      select id from public.org_nodes where head_user_id = (select auth.uid())
    )
    union
    select department_id from public.v_user_departments where user_id = (select auth.uid())
  );
end; $$;

-- 내가 편집/취합 가능한 부서노드 id 배열 (내가 직접 head인 부서만 = depth 0)
create or replace function private.my_editable_dept_ids()
returns uuid[] language plpgsql stable security definer set search_path = '' as $$
begin
  return array(
    select id from public.org_nodes
    where head_user_id = (select auth.uid()) and type in ('department','role','company')
  );
end; $$;

-- 전사 권한 여부 (대표이사 = apex)
-- 모델: company 루트, 그 직속 자식(대표이사 role 등)의 head 또는 person-child.
-- (본부장은 부서 노드 head일 뿐 apex가 아니므로 제외됨)
create or replace function private.is_executive()
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then return false; end if;
  return exists (
    -- 회사 루트의 head
    select 1 from public.org_nodes where parent_id is null and head_user_id = uid
  ) or exists (
    -- 회사 루트 직속 노드(예: 대표이사 role)의 head 또는 첫 person-child 또는 본인 person
    select 1 from public.org_nodes apex
    where apex.parent_id = (select id from public.org_nodes where parent_id is null)
      and (
        apex.head_user_id = uid
        or (apex.type = 'person' and apex.user_id = uid)
        or exists (
          select 1 from public.org_nodes pc
          where pc.parent_id = apex.id and pc.type = 'person' and pc.user_id = uid
        )
      )
  );
end; $$;

-- 내 관할 최상위 노드(들) — 대시보드 시작점 (readable 중 조상이 내 head집합에 없는 것)
create or replace function private.my_scope_roots()
returns uuid[] language plpgsql stable security definer set search_path = '' as $$
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

grant usage on schema private to authenticated;
grant execute on function private.my_readable_dept_ids() to authenticated;
grant execute on function private.my_editable_dept_ids() to authenticated;
grant execute on function private.is_executive() to authenticated;
grant execute on function private.my_scope_roots() to authenticated;
