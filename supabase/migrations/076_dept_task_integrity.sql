-- 076_dept_task_integrity.sql
-- 부서업무 S2 무결성 트리거 (🟥 DC-SEC 075 잔여 보강 — DB 방어).
-- 1) dept_task 담당자(assignee)는 해당 부서 서브트리 소속 person이어야 함 (서버액션 우회 방어).
-- 2) 댓글 parent_thread_id는 동일 log_id의 스레드만 가리킬 수 있음 (LOW-2).
-- 개인 일일업무(task_kind='personal')에는 전혀 영향 없음.

-- ── 1. 담당자 무결성 ──
create or replace function private.assert_dept_task_assignee()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if NEW.task_kind = 'dept_task' and NEW.assignee_user_id is not null then
    if NEW.department_id is null then
      raise exception 'dept_task: 담당자 지정에는 department_id가 필요합니다';
    end if;
    -- 담당자는 department_id 서브트리(자기 부서 포함) 내 person이어야 함
    if not exists (
      select 1
      from public.org_nodes p
      join public.org_node_closure c on c.descendant_id = p.parent_id
      where p.type = 'person'
        and p.user_id = NEW.assignee_user_id
        and c.ancestor_id = NEW.department_id
    ) then
      raise exception '담당자(%)가 부서(%) 소속이 아닙니다', NEW.assignee_user_id, NEW.department_id;
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_dept_task_assignee on public.daily_logs;
create trigger trg_dept_task_assignee
  before insert or update of assignee_user_id, department_id, task_kind on public.daily_logs
  for each row execute function private.assert_dept_task_assignee();

-- ── 2. 댓글 parent_thread 동일 로그 제약 ──
create or replace function private.assert_thread_same_log()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if NEW.parent_thread_id is not null then
    if not exists (
      select 1 from public.daily_log_threads t
      where t.id = NEW.parent_thread_id and t.log_id = NEW.log_id
    ) then
      raise exception 'parent_thread_id는 동일 로그의 댓글만 가리킬 수 있습니다';
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_thread_same_log on public.daily_log_threads;
create trigger trg_thread_same_log
  before insert or update of parent_thread_id, log_id on public.daily_log_threads
  for each row execute function private.assert_thread_same_log();
