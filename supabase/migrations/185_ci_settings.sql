-- 185_ci_settings.sql
-- CI 설정 체계 — 3계층 스코프 + 감사 로그(append-only, never-block)
-- 설계: 01-db-schema.md §3 / 설계서 §10.1~10.3
-- 원칙: 설정은 DB, 관리는 UI. env에는 DB 접속정보와 암호화 마스터 키만 남는다.

begin;

create table if not exists ci_settings (
  id           uuid primary key default gen_random_uuid(),
  scope        ci_setting_scope not null,
  scope_id     uuid,                      -- system=null, workspace=ws.id, user=profiles.id
  key          text not null,             -- 점 구분. 'flag.' 접두는 feature flag
  value        jsonb not null,            -- 암호화 시 {v,iv,ct,tag} 봉투
  is_encrypted boolean not null default false,
  version      integer not null default 1,
  updated_by   uuid references profiles(id),
  updated_at   timestamptz not null default now(),
  constraint ci_settings_scope_id_shape check (
    (scope = 'system' and scope_id is null) or
    (scope <> 'system' and scope_id is not null)
  )
);

-- scope_id가 null일 수 있으므로 표현식 유니크 인덱스
create unique index if not exists uq_ci_settings_key
  on ci_settings (scope, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
create index if not exists idx_ci_settings_scope_lookup
  on ci_settings (scope, scope_id);

create table if not exists ci_setting_audits (
  id          uuid primary key default gen_random_uuid(),
  setting_key text not null,
  scope       ci_setting_scope not null,
  scope_id    uuid,
  old_value   jsonb,                      -- 암호화 항목은 {"masked":true}
  new_value   jsonb,
  actor_id    uuid references profiles(id),
  at          timestamptz not null default now()
);
create index if not exists idx_ci_setting_audits_key_at
  on ci_setting_audits (setting_key, at desc);
create index if not exists idx_ci_setting_audits_scope
  on ci_setting_audits (scope, scope_id, at desc);

-- ── 감사 트리거 (never-block) ───────────────────────────────────
-- 감사 기록 실패가 설정 저장을 막아서는 안 된다. 예외를 삼키되 저장은 통과시킨다.
create or replace function ci_settings_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  begin
    if tg_op = 'DELETE' then
      v_old := case when old.is_encrypted then '{"masked":true}'::jsonb else old.value end;
      v_new := null;
      insert into ci_setting_audits (setting_key, scope, scope_id, old_value, new_value, actor_id)
      values (old.key, old.scope, old.scope_id, v_old, v_new, auth.uid());
    else
      v_old := case
        when tg_op = 'INSERT' then null
        when old.is_encrypted then '{"masked":true}'::jsonb
        else old.value end;
      v_new := case when new.is_encrypted then '{"masked":true}'::jsonb else new.value end;
      insert into ci_setting_audits (setting_key, scope, scope_id, old_value, new_value, actor_id)
      values (new.key, new.scope, new.scope_id, v_old, v_new, auth.uid());
    end if;
  exception when others then
    null;  -- 의도적: 감사 실패가 사용자 저장을 차단하지 않는다
  end;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_ci_settings_audit on ci_settings;
create trigger trg_ci_settings_audit
  after insert or update or delete on ci_settings
  for each row execute function ci_settings_audit();

-- version 자동 증가 (낙관적 잠금은 애플리케이션이 where version = ? 로 검사)
create or replace function ci_settings_bump_version()
returns trigger language plpgsql as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_ci_settings_version on ci_settings;
create trigger trg_ci_settings_version
  before update on ci_settings
  for each row when (old.value is distinct from new.value)
  execute function ci_settings_bump_version();

-- ── RLS ─────────────────────────────────────────────────────────
alter table ci_settings       enable row level security;
alter table ci_setting_audits enable row level security;

drop policy if exists ci_settings_select on ci_settings;
create policy ci_settings_select on ci_settings for select using (
  (scope = 'user'      and scope_id = auth.uid()) or
  (scope = 'workspace' and ci_is_member(scope_id)) or
  (scope = 'system'    and auth.uid() is not null)   -- 읽기는 허용(기본값 해석에 필요)
);

drop policy if exists ci_settings_write on ci_settings;
create policy ci_settings_write on ci_settings for insert with check (
  (scope = 'user'      and scope_id = auth.uid()) or
  (scope = 'workspace' and ci_can_admin(scope_id)) or
  (scope = 'system'    and ci_is_app_admin())
);

drop policy if exists ci_settings_update on ci_settings;
create policy ci_settings_update on ci_settings for update using (
  (scope = 'user'      and scope_id = auth.uid()) or
  (scope = 'workspace' and ci_can_admin(scope_id)) or
  (scope = 'system'    and ci_is_app_admin())
) with check (
  (scope = 'user'      and scope_id = auth.uid()) or
  (scope = 'workspace' and ci_can_admin(scope_id)) or
  (scope = 'system'    and ci_is_app_admin())
);

drop policy if exists ci_settings_delete on ci_settings;
create policy ci_settings_delete on ci_settings for delete using (
  (scope = 'user'      and scope_id = auth.uid()) or
  (scope = 'workspace' and ci_can_admin(scope_id)) or
  (scope = 'system'    and ci_is_app_admin())
);

-- 감사 로그: 읽기만. 삽입은 security definer 트리거가, 수정/삭제는 아무도 못 한다.
drop policy if exists ci_setting_audits_select on ci_setting_audits;
create policy ci_setting_audits_select on ci_setting_audits for select using (
  (scope = 'user'      and scope_id = auth.uid()) or
  (scope = 'workspace' and ci_is_member(scope_id)) or
  (scope = 'system'    and ci_is_app_admin())
);
-- insert/update/delete 정책 없음 = 전면 차단 (append-only 보장)

commit;
