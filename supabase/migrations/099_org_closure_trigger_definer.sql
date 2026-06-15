-- 098: org_node_closure 트리거 함수 SECURITY DEFINER 전환 (권한 버그 수정)
-- 증상: 조직도 '노드 추가' 시 "permission denied for table org_node_closure".
-- 원인: 046에서 org_node_closure 를 authenticated 로부터 revoke all 했는데,
--       org_nodes INSERT/UPDATE 트리거 함수가 SECURITY DEFINER 가 아니라
--       호출자(authenticated) 권한으로 실행 → closure 읽기/쓰기 거부.
-- 수정: closure 를 유지하는 시스템 트리거 3종을 SECURITY DEFINER + search_path='' +
--       public 스키마 정규화로 재정의. 트리거 자체는 동일 함수명을 가리키므로 재생성 불필요.
-- 안전: 권한 경계 불변(직접 접근은 여전히 함수로만). 데이터 변경 없음.

-- 2-1. INSERT: 자기행(depth0) + (부모의 모든 조상 → 새 노드)
create or replace function fn_org_closure_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.org_node_closure (ancestor_id, descendant_id, depth)
  values (new.id, new.id, 0)
  on conflict do nothing;

  if new.parent_id is not null then
    insert into public.org_node_closure (ancestor_id, descendant_id, depth)
    select c.ancestor_id, new.id, c.depth + 1
    from public.org_node_closure c
    where c.descendant_id = new.parent_id
    on conflict do nothing;
  end if;
  return new;
end; $$;

-- 2-2. BEFORE UPDATE: 사이클 방지(자기 자손 아래로 이동 차단)
create or replace function fn_org_closure_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.parent_id is not null
     and new.parent_id is distinct from old.parent_id then
    if exists (
      select 1 from public.org_node_closure
      where ancestor_id = new.id and descendant_id = new.parent_id
    ) then
      raise exception 'org_nodes: 자기 자손(%) 아래로 이동할 수 없습니다', new.parent_id;
    end if;
  end if;
  return new;
end; $$;

-- 2-3. AFTER UPDATE OF parent_id: 서브트리 이동 재배선
create or replace function fn_org_closure_after_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not (new.parent_id is distinct from old.parent_id) then
    return new;
  end if;

  delete from public.org_node_closure
  where descendant_id in (
          select descendant_id from public.org_node_closure where ancestor_id = new.id
        )
    and ancestor_id in (
          select ancestor_id from public.org_node_closure
          where descendant_id = new.id and ancestor_id <> descendant_id
        );

  if new.parent_id is not null then
    insert into public.org_node_closure (ancestor_id, descendant_id, depth)
    select super.ancestor_id, sub.descendant_id, super.depth + sub.depth + 1
    from public.org_node_closure super
    cross join public.org_node_closure sub
    where super.descendant_id = new.parent_id
      and sub.ancestor_id = new.id
    on conflict do nothing;
  end if;
  return new;
end; $$;
