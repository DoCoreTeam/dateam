-- 257 조직을 지울 때 붙어 있는 기록을 어디로 옮길지 정한다
--
-- 왜: 조직도에서 부서를 지우면 아래 오류가 뜨고 아무 일도 일어나지 않았다 (실측 2026-09-17).
--   update or delete on table "org_nodes" violates foreign key constraint
--   "calendar_events_department_id_fkey" on table "calendar_events"
--   org_nodes 를 가리키는 표가 열셋인데 그중 여덟이 NO ACTION 이라, 그 부서로 한 번이라도
--   일정·일일업무·주간보고를 남겼으면 그 부서는 **영원히 못 지운다.** 부서 개편은 늘 있는 일인데
--   그때마다 데이터가 인질이 된다.
--
-- 고르지 않은 길: 외래키를 ON DELETE SET NULL 로 바꾸는 것. 그러면 지워지기는 하지만
--   지난 기록의 소속이 조용히 사라진다 — 작년 주간보고가 어느 부서 것이었는지 알 수 없게 된다.
--   소속은 **작성 시점에 얼어붙은 사실**이라(마이그 047) 비우면 그 사실이 없어진다.
--   그래서 비우지 않고 **옮긴다.** 어디로 옮길지는 사람이 정한다 (사용자 지시 2026-09-17).
--
-- 한 트랜잭션인 이유: 옮기다 말면 어떤 표는 옛 부서를, 어떤 표는 새 부서를 가리킨다.
--   그 상태는 어느 쪽도 진실이 아니다.
--
-- 되돌리기:
--   drop function if exists org_node_delete_transfer(uuid, uuid);
--   drop function if exists org_node_impact(uuid);

-- ── 무엇이 얼마나 붙어 있나. 사람이 고르기 전에 보는 숫자다
create or replace function org_node_impact(p_node uuid)
returns table (source text, label text, cnt bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin' and p.deleted_at is null) then
    raise exception '관리자 권한이 필요합니다';
  end if;

  return query
  select t.source, t.label, t.cnt from (
    select 'calendar_events'::text, '일정'::text, count(*) from calendar_events where department_id = p_node
    union all select 'daily_logs', '일일업무', count(*) from daily_logs where department_id = p_node
    union all select 'meeting_notes', '회의노트', count(*) from meeting_notes where department_id = p_node
    union all select 'weekly_reports', '주간보고', count(*) from weekly_reports where department_id = p_node
    union all select 'weekly_report_items', '주간보고 작업분', count(*) from weekly_report_items where department_id = p_node
    union all select 'weekly_report_activity', '주간보고 기록', count(*) from weekly_report_activity where department_id = p_node
    union all select 'weekly_report_snapshots', '주간보고 되살리기용 사본', count(*) from weekly_report_snapshots where department_id = p_node
    union all select 'dept_weekly_reports', '부서 주간보고', count(*) from dept_weekly_reports where department_id = p_node
    union all select 'report_access_log', '열람 기록', count(*) from report_access_log where department_id = p_node
    union all select 'projects', '프로젝트', count(*) from projects where department_id = p_node
    union all select 'org_nodes', '하위 조직', count(*) from org_nodes where parent_id = p_node
  ) as t(source, label, cnt)
  where t.cnt > 0
  order by t.cnt desc;
end; $$;

revoke all on function org_node_impact(uuid) from anon;
grant execute on function org_node_impact(uuid) to authenticated;

-- ── 옮기고 지운다. 한 트랜잭션
create or replace function org_node_delete_transfer(p_node uuid, p_target uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_parent   uuid;
  v_rows     bigint;   -- 옮겨야 할 기록 수 (하위 조직은 빼고 센다 — 그건 옮기는 것이 아니라 재배치다)
  v_children bigint;
  v_collide  text;
  v_dest     uuid;
  v_moved    jsonb := '{}'::jsonb;
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin' and p.deleted_at is null) then
    raise exception '관리자 권한이 필요합니다';
  end if;

  select parent_id into v_parent from org_nodes where id = p_node;
  if not found then raise exception '그 조직이 없습니다'; end if;

  select coalesce(sum(cnt) filter (where source <> 'org_nodes'), 0),
         coalesce(sum(cnt) filter (where source =  'org_nodes'), 0)
    into v_rows, v_children
  from org_node_impact(p_node);

  if p_target is not null then
    if p_target = p_node then
      raise exception '자기 자신으로는 옮길 수 없습니다';
    end if;
    if not exists (select 1 from org_nodes where id = p_target) then
      raise exception '옮겨 갈 조직이 없습니다';
    end if;
    -- 자기 아래로 옮기면 지운 뒤 그 기록도 함께 사라진다
    if exists (
      select 1 from org_node_closure
      where ancestor_id = p_node and descendant_id = p_target and depth > 0
    ) then
      raise exception '지우는 조직의 하위로는 옮길 수 없습니다';
    end if;
  elsif v_rows > 0 then
    -- 하위 조직만 있고 기록이 0건이면 물어볼 것이 없다. 자식은 한 단계 위로 올리면 된다
    raise exception '옮겨 갈 조직을 정해 주세요 (붙어 있는 기록 %건)', v_rows;
  end if;

  -- 부서 주간보고는 (부서, 주) 가 유일하다. 같은 주가 양쪽에 있으면 옮기다 부딪힌다.
  -- 조용히 하나를 버리지 않고 어느 주가 겹치는지 말하고 멈춘다.
  if p_target is not null then
    select string_agg(distinct a.week_start::text, ', ') into v_collide
    from dept_weekly_reports a
    where a.department_id = p_node
      and exists (select 1 from dept_weekly_reports b
                  where b.department_id = p_target and b.week_start = a.week_start);
    if v_collide is not null then
      raise exception '부서 주간보고가 같은 주에 양쪽에 있습니다 (%). 먼저 한쪽을 정리해 주세요', v_collide;
    end if;
  end if;

  if p_target is not null then
    update calendar_events          set department_id = p_target where department_id = p_node;
    update daily_logs               set department_id = p_target where department_id = p_node;
    update meeting_notes            set department_id = p_target where department_id = p_node;
    update weekly_reports           set department_id = p_target where department_id = p_node;
    update weekly_report_items      set department_id = p_target where department_id = p_node;
    update weekly_report_activity   set department_id = p_target where department_id = p_node;
    update weekly_report_snapshots  set department_id = p_target where department_id = p_node;
    update dept_weekly_reports      set department_id = p_target where department_id = p_node;
    update report_access_log        set department_id = p_target where department_id = p_node;
    update projects                 set department_id = p_target where department_id = p_node;
    v_moved := jsonb_build_object('target', p_target, 'rows', v_rows);
  end if;

  -- 하위 조직은 옮겨 갈 조직이 흡수한다. 정한 곳이 없으면 한 단계 위로 올린다.
  -- (parent_id 는 ON DELETE RESTRICT 라 이걸 안 하면 자식 있는 조직은 아예 못 지운다)
  v_dest := coalesce(p_target, v_parent);
  update org_nodes set parent_id = v_dest where parent_id = p_node;

  -- 부서장 참조는 지우는 조직과 함께 사라지므로 따로 치울 것이 없다(노드 자체가 간다)
  delete from org_nodes where id = p_node;

  return jsonb_build_object('deleted', p_node, 'moved', v_moved, 'children', v_children, 'children_to', v_dest);
end; $$;

revoke all on function org_node_delete_transfer(uuid, uuid) from anon;
grant execute on function org_node_delete_transfer(uuid, uuid) to authenticated;
