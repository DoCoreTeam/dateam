-- 131_dept_task_assignee_allow_head.sql
-- 부서업무 담당자에 부서장(head_user_id) 허용.
-- 배경: 076 트리거는 담당자를 '서브트리 person 노드'로만 제한했다. 부서장은 person 노드가 아니라
--   부서 노드의 head_user_id 속성이라 담당자로 지정 시 거부되던 문제(서버액션 후보에는 보이는데 저장 실패).
-- 변경: 담당자는 (a) 서브트리 소속 person 이거나, (b) department_id(자기 부서 포함) 서브트리 내
--   어떤 노드의 head_user_id 이면 허용. 그 외 의미·트리거 구성은 076과 동일.
-- 개인 일일업무(task_kind='personal')에는 전혀 영향 없음. assert_thread_same_log는 미변경.

create or replace function private.assert_dept_task_assignee()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if NEW.task_kind = 'dept_task' and NEW.assignee_user_id is not null then
    if NEW.department_id is null then
      raise exception 'dept_task: 담당자 지정에는 department_id가 필요합니다';
    end if;
    -- (a) 담당자가 서브트리(자기 부서 포함) 내 person, 또는
    -- (b) 담당자가 서브트리 내 어떤 노드의 head(부서장).
    if not exists (
      select 1
      from public.org_nodes p
      join public.org_node_closure c on c.descendant_id = p.parent_id
      where p.type = 'person'
        and p.user_id = NEW.assignee_user_id
        and c.ancestor_id = NEW.department_id
    ) and not exists (
      select 1
      from public.org_nodes h
      join public.org_node_closure c on c.descendant_id = h.id
      where h.head_user_id = NEW.assignee_user_id
        and c.ancestor_id = NEW.department_id
    ) then
      raise exception '담당자(%)가 부서(%) 소속이 아닙니다', NEW.assignee_user_id, NEW.department_id;
    end if;
  end if;
  return NEW;
end $$;
