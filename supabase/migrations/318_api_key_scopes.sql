-- 318 API 키 범위 만료일 쓰는 곳, 승인 요청, 멱등, 쓰기 감사 (P0158 I03)
--
-- 왜: teamda CLI 가 웹 동작 859개를 키 하나로 부르게 된다
--   지금 키에는 범위가 없어 키를 가진 쪽이 계정 권한 전부를 쓴다
--   만료일도 없어 한 번 새면 사람이 지울 때까지 통한다
--   위험 동작(approve send delete admin)을 범위 없이 부르면 바로 실행하지 않고 사람 승인을 받는다
--
-- 보안 (LOOP.md 7절)
--   S1 새 표 셋 모두 이 마이그레이션에서 RLS 를 켬, TO public 정책 없음
--   anon 에게서 새 표 권한 전부 회수, authenticated 는 본인 행 읽기만
--   쓰기는 관문(서비스롤)만 함, 그 위에 키 인증이 사람 확인 자리
--   감사 표는 고치거나 지우는 정책을 두지 않음 (고칠 수 있는 기록은 기록이 아님)
--
-- 되돌리기
--   drop function if exists public.record_api_key_write_hit(uuid);
--   alter table public.api_key_usage_minute drop column if exists write_hits;
--   drop table if exists public.api_write_audit, public.api_idempotency, public.api_approval_requests;
--   alter table public.api_keys drop column if exists scopes, drop column if exists expires_at, drop column if exists purpose;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) 키에 범위 만료일 쓰는 곳
--    기존 키는 기본값으로 read 만 갖는다, 더 필요하면 키를 새로 만든다
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.api_keys
  add column if not exists scopes text[] not null default array['read']::text[],
  add column if not exists expires_at timestamptz,
  add column if not exists purpose text;

alter table public.api_keys drop constraint if exists api_keys_scopes_known;
alter table public.api_keys add constraint api_keys_scopes_known check (
  cardinality(scopes) > 0
  and scopes <@ array['read', 'write', 'approve', 'send', 'delete', 'admin']::text[]
);

alter table public.api_keys drop constraint if exists api_keys_purpose_len;
alter table public.api_keys add constraint api_keys_purpose_len check (purpose is null or char_length(purpose) <= 200);

comment on column public.api_keys.scopes is '키 범위, 실제 권한은 계정 권한과 이 범위의 교집합';
comment on column public.api_keys.expires_at is '지나면 키 인증이 403, 비면 만료 없음(이 마이그레이션 전 키)';
comment on column public.api_keys.purpose is '쓰는 곳 이름, 사람이 읽는 표시';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) 승인 요청, 범위 밖 위험 동작은 여기 쌓이고 키 소유자가 승인하면 같은 처리 함수가 돈다
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.api_approval_requests (
  id             uuid primary key default gen_random_uuid(),
  key_id         uuid not null references public.api_keys(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  action_name    text not null,
  required_scope text not null check (required_scope in ('approve', 'send', 'delete', 'admin')),
  method         text not null check (method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ACTION')),
  path           text not null,
  payload        jsonb not null default '{}'::jsonb,
  status         text not null default 'PENDING'
                 check (status in ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'FAILED')),
  result         jsonb,
  agent          text,
  request_id     text,
  expires_at     timestamptz not null default now() + interval '24 hours',
  decided_by     uuid references auth.users(id) on delete set null,
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists api_approval_requests_user_idx on public.api_approval_requests (user_id, created_at desc);

alter table public.api_approval_requests enable row level security;

drop policy if exists api_approval_requests_owner_read on public.api_approval_requests;
create policy api_approval_requests_owner_read on public.api_approval_requests
  for select to authenticated
  using (user_id = (select auth.uid()));

comment on table public.api_approval_requests is
  '범위 밖 위험 동작의 승인 요청, 결정과 실행은 서버(서비스롤)가 키 소유자 본인 또는 관리자 확인 뒤에만 함';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) 멱등, 같은 Idempotency-Key 재요청은 처음 결과를 돌려준다 (24시간)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.api_idempotency (
  key_id       uuid not null references public.api_keys(id) on delete cascade,
  idem_key     text not null check (char_length(idem_key) between 1 and 200),
  request_hash text not null,
  status       integer not null,
  response     jsonb not null,
  created_at   timestamptz not null default now(),
  primary key (key_id, idem_key)
);

create index if not exists api_idempotency_created_idx on public.api_idempotency (created_at);

-- 서비스롤만 씀, 정책 없음 = authenticated anon 은 아무것도 못 읽음
alter table public.api_idempotency enable row level security;

comment on table public.api_idempotency is '키별 멱등 응답 보관, record_api_key_write_hit 가 24시간 지난 행을 치움';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) 쓰기 감사, 키로 한 쓰기는 전부 남는다 (덧붙이기만)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.api_write_audit (
  id          bigint generated always as identity primary key,
  key_id      uuid references public.api_keys(id) on delete set null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  agent       text,
  request_id  text,
  ip          text,
  action_name text not null,
  method      text not null,
  path        text not null,
  status      integer not null,
  dry_run     boolean not null default false,
  approval_id uuid references public.api_approval_requests(id) on delete set null,
  before      jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists api_write_audit_user_idx on public.api_write_audit (user_id, created_at desc);
create index if not exists api_write_audit_key_idx on public.api_write_audit (key_id, created_at desc);

alter table public.api_write_audit enable row level security;

drop policy if exists api_write_audit_owner_read on public.api_write_audit;
create policy api_write_audit_owner_read on public.api_write_audit
  for select to authenticated
  using (user_id = (select auth.uid()));

comment on table public.api_write_audit is
  '키로 한 쓰기 기록, 고치거나 지우는 정책 없음. 관리자 전체 보기는 서버가 역할 확인 뒤 서비스롤로';

-- 새 표 권한: anon 전부 회수, authenticated 는 읽기만 (행은 정책이 거름)
revoke all on public.api_approval_requests, public.api_idempotency, public.api_write_audit from anon, public;
revoke all on public.api_approval_requests, public.api_idempotency, public.api_write_audit from authenticated;
grant select on public.api_approval_requests, public.api_write_audit to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) 쓰기 분당 한도, 읽기 한도(record_api_key_hit)와 같은 분 창에 칸 하나를 더한다
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.api_key_usage_minute
  add column if not exists write_hits integer not null default 0;

-- OUT 이름을 칼럼과 겹치지 않게 둠 (225 의 모호성 사고)
create or replace function public.record_api_key_write_hit(p_key_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minute timestamptz := date_trunc('minute', now());
  v_writes integer;
begin
  insert into public.api_key_usage_minute as u (key_id, minute_start, hits, write_hits)
  values (p_key_id, v_minute, 0, 1)
  on conflict (key_id, minute_start)
  do update set write_hits = u.write_hits + 1
  returning u.write_hits into v_writes;

  delete from public.api_idempotency i where i.created_at < now() - interval '24 hours';

  return v_writes;
end;
$$;

comment on function public.record_api_key_write_hit(uuid) is
  '키로 한 쓰기 1건을 세고 이번 분의 쓰기 수를 돌려준다. 쓰기 한도 판정의 근거';

revoke all on function public.record_api_key_write_hit(uuid) from public, anon, authenticated;
