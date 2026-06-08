-- 075_dept_task_management.sql
-- 부서 업무 관리 S1 (데이터/RLS). 확정안 ⓐ: daily_logs 확장 + daily_log_threads 확장.
-- 설계 원칙: 기존 개인 일일업무(task_kind='personal') RLS를 한 글자도 바꾸지 않고,
--           dept_task 행에만 적용되는 OR 분기만 추가 → 개인 로그 본인-격리 무회귀.
-- 권한 함수는 기존 private.* (046/047/050) 100% 재사용, 신규 함수 0.
-- 롤백 가능: ADD COLUMN(IF NOT EXISTS)·정책 교체는 되돌리기 가능. 컬럼 drop은 데이터 손실 주의.

-- ── 1. daily_logs 확장 컬럼 (전부 기본값/nullable → 기존 행 무영향) ──
alter table public.daily_logs
  add column if not exists task_kind        text not null default 'personal'
       check (task_kind in ('personal','dept_task')),
  add column if not exists assignee_user_id uuid references public.profiles(id),
  add column if not exists department_id     uuid references public.org_nodes(id),
  add column if not exists progress          int  not null default 0 check (progress between 0 and 100),
  add column if not exists checklist         jsonb not null default '[]'::jsonb;

create index if not exists idx_daily_logs_dept_task
  on public.daily_logs (department_id, task_kind) where task_kind = 'dept_task';
create index if not exists idx_daily_logs_assignee
  on public.daily_logs (assignee_user_id) where assignee_user_id is not null;

-- ── 2. daily_log_threads 확장 (댓글 작성자 식별 + 대댓글 대비) ──
alter table public.daily_log_threads
  add column if not exists author_user_id   uuid references public.profiles(id),
  add column if not exists parent_thread_id uuid references public.daily_log_threads(id);

-- ── 3. daily_logs RLS 재작성 (기존 분기 보존 + dept_task 분기 추가) ──
drop policy if exists daily_logs_select on public.daily_logs;
create policy daily_logs_select on public.daily_logs for select to authenticated
using (
  -- [기존 보존] 본인 / admin / 계층(개인로그 부서장 열람)
  user_id = (select auth.uid())
  or exists (select 1 from public.profiles p
             where p.id = (select auth.uid()) and p.role = 'admin' and p.deleted_at is null)
  or ((select private.hierarchy_enabled())
      and (user_id = any(private.my_readable_user_ids()) or (select private.is_executive())))
  -- [신규] dept_task: 부서 가시성 또는 담당자
  or (task_kind = 'dept_task'
      and (department_id = any(private.my_readable_dept_ids())
           or assignee_user_id = (select auth.uid())))
);

drop policy if exists daily_logs_insert on public.daily_logs;
create policy daily_logs_insert on public.daily_logs for insert to authenticated
with check (
  user_id = (select auth.uid())                       -- [기존 보존] 작성자=본인
  and (
    task_kind = 'personal'                            -- 개인 로그: 추가 제약 없음(기존 동작)
    or department_id = any(private.my_readable_dept_ids())  -- dept_task: 가시 부서에만 생성
    or exists (select 1 from public.profiles p
               where p.id = (select auth.uid()) and p.role = 'admin' and p.deleted_at is null)
  )
);

drop policy if exists daily_logs_update on public.daily_logs;
create policy daily_logs_update on public.daily_logs for update to authenticated
using (
  user_id = (select auth.uid())
  or (task_kind = 'dept_task'
      and (assignee_user_id = (select auth.uid())
           or department_id = any(private.my_editable_dept_ids())
           or exists (select 1 from public.profiles p
                      where p.id = (select auth.uid()) and p.role = 'admin' and p.deleted_at is null)))
)
with check (
  user_id = (select auth.uid())
  or (task_kind = 'dept_task'
      and (assignee_user_id = (select auth.uid())
           or department_id = any(private.my_editable_dept_ids())
           or exists (select 1 from public.profiles p
                      where p.id = (select auth.uid()) and p.role = 'admin' and p.deleted_at is null)))
);
-- 주의(D-3): assignee_user_id를 *타인으로* 지정/변경하는 컬럼-레벨 제약은 RLS로 표현 불가.
--           → 서버액션 assignTask에서 my_editable_dept_ids 검증으로 강제(S2). RLS는 행 쓰기 권한까지만.

drop policy if exists daily_logs_delete on public.daily_logs;
create policy daily_logs_delete on public.daily_logs for delete to authenticated
using (
  user_id = (select auth.uid())
  or (task_kind = 'dept_task'
      and (department_id = any(private.my_editable_dept_ids())
           or exists (select 1 from public.profiles p
                      where p.id = (select auth.uid()) and p.role = 'admin' and p.deleted_at is null)))
);

-- ── 4. daily_log_threads RLS 재작성 (로그 가시자 읽기 / 본인 댓글만 쓰기) ──
-- 기존 단일 ALL 정책("users: own threads", 로그 작성자 본인만) → 명령별 분리.
drop policy if exists "users: own threads" on public.daily_log_threads;

create policy dlt_select on public.daily_log_threads for select to authenticated
using (
  exists (
    select 1 from public.daily_logs dl
    where dl.id = daily_log_threads.log_id
      and (
        dl.user_id = (select auth.uid())
        or exists (select 1 from public.profiles p
                   where p.id = (select auth.uid()) and p.role = 'admin' and p.deleted_at is null)
        or ((select private.hierarchy_enabled())
            and (dl.user_id = any(private.my_readable_user_ids()) or (select private.is_executive())))
        or (dl.task_kind = 'dept_task'
            and (dl.department_id = any(private.my_readable_dept_ids())
                 or dl.assignee_user_id = (select auth.uid())))
      )
  )
);

create policy dlt_insert on public.daily_log_threads for insert to authenticated
with check (
  author_user_id = (select auth.uid())                 -- 댓글 작성자=본인
  and exists (                                          -- 볼 수 있는 로그에만
    select 1 from public.daily_logs dl
    where dl.id = daily_log_threads.log_id
      and (
        dl.user_id = (select auth.uid())
        or ((select private.hierarchy_enabled())
            and (dl.user_id = any(private.my_readable_user_ids()) or (select private.is_executive())))
        or (dl.task_kind = 'dept_task'
            and (dl.department_id = any(private.my_readable_dept_ids())
                 or dl.assignee_user_id = (select auth.uid())))
      )
  )
);

create policy dlt_update on public.daily_log_threads for update to authenticated
using (author_user_id = (select auth.uid()))
with check (author_user_id = (select auth.uid()));

create policy dlt_delete on public.daily_log_threads for delete to authenticated
using (author_user_id = (select auth.uid()));
