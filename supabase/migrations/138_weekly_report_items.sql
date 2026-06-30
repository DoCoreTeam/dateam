-- 138_weekly_report_items.sql
-- 주간보고 AI 자동초안(push) 전환용 "항목" 작업영역 테이블.
-- 왜: 기존 weekly_reports 는 (category/performance/plan/issues) 텍스트 묶음 1행 구조라
--     AI 자동초안과 수동입력을 "개별 단위"(체크박스 포함/제외·X 삭제·출처태그·신뢰도)로
--     표현할 수 없다. 이 테이블이 그 단위 작업영역(SSOT). 확정 시 기존 weekly_reports 로
--     직렬화하는 건 BE 책무(다음 단계) — 기존 테이블/RPC 는 건드리지 않음(하위호환).

-- ── 1. 항목 테이블 (ADD only, 신규) ──
create table if not exists weekly_report_items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id),
  week_start    date not null,                                 -- 월요일(DOW=1) — 기존 weekly_reports 정책 동일
  department_id uuid references org_nodes(id),                 -- 작성시점 부서 동결(기존 정책 동일)
  category      text not null default '',                      -- 구분(분류 1층)
  section       text not null check (section in ('performance','plan','issues')),  -- 분류 2층
  content       text not null default '',                      -- 항목 본문(plain 또는 경량 HTML)
  origin        text not null check (origin in ('auto','manual')) default 'manual',
  confidence    numeric,                                       -- AI 신뢰도 0~1, manual 은 null
  is_included   boolean not null default true,                 -- 체크박스(제외 시 false)
  source_ref    jsonb,                                         -- provenance {kind:'daily'|'calendar', id:uuid}
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz                                    -- 소프트삭제(X)
);

create index if not exists idx_wri_user_week
  on weekly_report_items (user_id, week_start) where deleted_at is null;
create index if not exists idx_wri_dept_week
  on weekly_report_items (department_id, week_start);

-- ── 2. updated_at 자동 갱신 트리거 (공용 touch 함수 없음 → 051/117 동일 스타일 전용 함수) ──
create or replace function fn_weekly_report_items_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_weekly_report_items_touch on weekly_report_items;
create trigger trg_weekly_report_items_touch before update on weekly_report_items
for each row execute function fn_weekly_report_items_touch();

-- ── 3. RLS (120_weekly_report_activity 와 동일 헬퍼·가시성 정책) ──
-- 주의: SELECT(wri_select)는 139_weekly_report_items_hardening.sql 에서 본인+executive로 좁혀진다
--       (미확정 작업영역을 부서장에게 노출하지 않기 위함). 아래는 138 도입 시점 정책.
alter table weekly_report_items enable row level security;

-- SELECT: 주간보고 가시성과 동일(플래그 OFF면 전원, ON이면 본인+관할부서+전사)
drop policy if exists wri_select on weekly_report_items;
create policy wri_select on weekly_report_items
for select to authenticated
using (
  (not (select private.hierarchy_enabled()))
  or user_id = (select auth.uid())
  or department_id = any(private.my_readable_dept_ids())
  or (select private.is_executive())
);

-- INSERT: 본인 행만
drop policy if exists wri_insert on weekly_report_items;
create policy wri_insert on weekly_report_items
for insert to authenticated
with check (user_id = (select auth.uid()));

-- UPDATE: 본인 행만 (소프트삭제·체크박스·정렬도 UPDATE 경로 → using+with check 둘 다 본인 한정)
drop policy if exists wri_update on weekly_report_items;
create policy wri_update on weekly_report_items
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- DELETE: 본인 행만 (소프트삭제가 정석이나 하드삭제도 본인 한정으로 허용)
drop policy if exists wri_delete on weekly_report_items;
create policy wri_delete on weekly_report_items
for delete to authenticated
using (user_id = (select auth.uid()));
-- service_role(admin client)은 RLS 우회 — 자동확정 등 시스템 경로용(이번 Phase 미사용).
