-- 172_ai_analysis_templates.sql
-- 브랜치 feature/list-analysis-template-engine의 163_ai_analysis_templates.sql을
-- 번호만 재할당해 이식 (163은 이미 마이그 163_market_prices_observation_original.sql이
-- 점유 중이라 충돌 — 실측 확인, 170/171/172로 재넘버링).
-- 원본: git show feature/list-analysis-template-engine:supabase/migrations/163_ai_analysis_templates.sql
--
-- 목록 심층분석 v2/v3 "지시→템플릿→필드채움" 엔진 — 템플릿 스토어 + 세션/항목 확장.
-- 큐레이션 6종은 코드 SSOT(lib/ai-chat/templates/catalog.ts) — DB엔 LLM생성·사용자커스텀만(드리프트 제거).
-- RLS/touch는 157(aias_admin_owner + fn_aias_touch) 패턴 재사용 — 동일 admin+owner 정합.
-- 170_ai_analysis_grouping.sql 적용 이후 순차 적용. 전부 additive(기존 컬럼/동작 무변경 — 하위호환).
--
-- ⚠️ 170과의 중복 제거: 원본 163은 ai_analysis_items에 `origin text not null default 'user'
-- check (origin in ('user','breadth'))`를 추가했으나, 170_ai_analysis_grouping.sql이 이미
-- 동일 컬럼명 `origin`을 더 넓은 의미(check ('structure','breadth','user'), 기본값 'structure')로
-- 선점했다. 같은 컬럼을 두 번 ALTER ADD COLUMN 하는 것 자체는 IF NOT EXISTS라 안전하지만,
-- default/check 제약이 서로 달라 의미가 충돌하므로 이 파일에서는 origin 컬럼 추가를 제거했다
-- (170의 정의가 최종 유효 — 'user'|'breadth'는 170의 값 집합에 포함되므로 의미 손실 없음).

create table if not exists ai_analysis_templates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  name        text not null,
  description text not null default '',
  fields      jsonb not null,            -- FieldSpec[]: {key,label,description,required} (catalog.ts SSOT)
  assembly    jsonb not null,            -- {mode:'table'|'sections', itemNoun} (catalog.ts SSOT)
  origin      text not null default 'custom' check (origin in ('llm','custom')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists idx_aiat_user_recent
  on ai_analysis_templates (user_id, updated_at desc)
  where deleted_at is null;

alter table ai_analysis_templates enable row level security;
drop policy if exists aiat_admin_owner on ai_analysis_templates;
create policy aiat_admin_owner on ai_analysis_templates
for all to authenticated
using (
  exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin' and deleted_at is null)
  and user_id = (select auth.uid())
)
with check (
  exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin' and deleted_at is null)
  and user_id = (select auth.uid())
);

create or replace function fn_aiat_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_aiat_touch on ai_analysis_templates;
create trigger trg_aiat_touch before update on ai_analysis_templates
for each row execute function fn_aiat_touch();

-- 세션 확장: 템플릿 동결 스냅샷(편집/삭제 면역) + 미결질문 + 넓이패스 리포트 + 취합실패 사유(은폐 제거)
alter table ai_analysis_sessions add column if not exists template_id       uuid references ai_analysis_templates(id) on delete set null;
alter table ai_analysis_sessions add column if not exists template_snapshot jsonb;
alter table ai_analysis_sessions add column if not exists questions         jsonb;
alter table ai_analysis_sessions add column if not exists breadth           jsonb;
alter table ai_analysis_sessions add column if not exists synth_error       text;

-- 항목 확장: 템플릿 필드 채움값(+근거/가정) + 빈 필수필드
-- (origin 컬럼은 170_ai_analysis_grouping.sql이 이미 추가했으므로 여기서는 생략 — 위 주석 참조)
alter table ai_analysis_items add column if not exists field_values jsonb;
alter table ai_analysis_items add column if not exists gaps         jsonb;
