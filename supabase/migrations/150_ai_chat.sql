-- 150_ai_chat.sql
-- AI 채팅(Claude 클론) 세션1: 대화/메시지 영속 + 토큰로그 provider 구분
-- feature 컬럼은 text이므로 'ai-chat' 값은 마이그레이션 불필요 (types/database.ts union만 확장)

-- 1) ai_token_logs에 프로바이더 구분 컬럼 추가 (기존 행은 null = gemini 시절 로그)
alter table ai_token_logs add column if not exists provider text;

-- 2) 대화 테이블
create table if not exists ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  title       text not null default '새 대화',
  provider    text not null check (provider in ('gemini','claude','openai')),
  model       text not null,
  system_prompt text,               -- 대화별 시스템프롬프트 (세션2 편집 UI에서 사용, 세션1은 항상 null)
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz          -- 소프트삭제 (복원 가능)
);
create index if not exists idx_aicc_user_recent
  on ai_conversations (user_id, pinned desc, updated_at desc)
  where deleted_at is null;

-- 3) 메시지 테이블
create table if not exists ai_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references ai_conversations(id) on delete cascade,
  role             text not null check (role in ('user','assistant')),
  content          text not null default '',
  thinking         text,                          -- Claude summarized thinking (있을 때만)
  provider         text,                          -- assistant 메시지의 생성 프로바이더
  model            text,                          -- assistant 메시지의 생성 모델
  prompt_tokens    integer,
  output_tokens    integer,
  stopped          boolean not null default false, -- 사용자 Stop으로 중단된 부분 응답
  error            text,                           -- 생성 실패 시 에러 메시지
  created_at       timestamptz not null default now()
);
create index if not exists idx_aicm_conv_time
  on ai_messages (conversation_id, created_at, id);

-- 4) RLS: admin 전용 + owner 스코프 (default-deny, 149 org_weekly_reports 패턴)
alter table ai_conversations enable row level security;
alter table ai_messages enable row level security;

drop policy if exists aicc_admin_owner on ai_conversations;
create policy aicc_admin_owner on ai_conversations
for all to authenticated
using (
  exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin' and deleted_at is null)
  and user_id = (select auth.uid())
)
with check (
  exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin' and deleted_at is null)
  and user_id = (select auth.uid())
);

drop policy if exists aicm_admin_owner on ai_messages;
create policy aicm_admin_owner on ai_messages
for all to authenticated
using (
  exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin' and deleted_at is null)
  and exists (select 1 from ai_conversations c
              where c.id = conversation_id and c.user_id = (select auth.uid()))
)
with check (
  exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin' and deleted_at is null)
  and exists (select 1 from ai_conversations c
              where c.id = conversation_id and c.user_id = (select auth.uid()))
);

-- 5) updated_at 자동 갱신 트리거 (149 fn_owr_touch 패턴)
create or replace function fn_aicc_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_aicc_touch on ai_conversations;
create trigger trg_aicc_touch before update on ai_conversations
for each row execute function fn_aicc_touch();

-- 6) 메시지 insert 시 부모 대화 updated_at 갱신 (최근 대화 정렬 소스)
create or replace function fn_aicm_touch_conv() returns trigger language plpgsql as $$
begin
  update ai_conversations set updated_at = now() where id = new.conversation_id;
  return new;
end; $$;
drop trigger if exists trg_aicm_touch_conv on ai_messages;
create trigger trg_aicm_touch_conv after insert on ai_messages
for each row execute function fn_aicm_touch_conv();

-- 7) 보안 정합 [C-1]: org_content(META에 gemini/claude/openai api_key·db_connection_url 평문 저장)의
--    SELECT RLS를 admin 전용으로 축소한다.
--    기존 003b 정책 org_content_select = USING(auth.uid() is not null) → 로그인한 모든 사용자(member/api_user)가
--    브라우저 anon 클라이언트로 `from('org_content').select('value').eq('key','META')` 하면 전 시크릿 유출.
--    앱의 모든 org_content 읽기는 service_role(createAdminClient, RLS 우회)이므로 이 축소는 기능에 무영향(전수 확인됨).
drop policy if exists org_content_select on org_content;
create policy org_content_select on org_content
for select to authenticated
using (exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin' and deleted_at is null));
