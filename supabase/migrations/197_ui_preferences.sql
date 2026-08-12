-- 197_ui_preferences.sql — 화면별 개인 설정(보기·개수·정렬)
--
-- 왜: 목록 화면의 보기 방식이 서버에 남지 않아서, 사용자가 매번 다시 골랐다
--   (현재 서버 저장소 0, localStorage 5화면뿐 — 기기를 바꾸면 사라진다).
-- 저장 범위는 view·size·sort뿐. **필터·검색어는 저장하지 않는다** —
--   다음 방문에 조건이 살아 있으면 "왜 데이터가 없지?"가 된다.
-- 우선순위는 앱이 정한다: URL > 이 테이블 > 화면 기본값.

create table if not exists public.ui_preferences (
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- 라우트 경로를 쓴다(예: '/contacts'). 화면이 곧 범위다.
  scope_key  text not null,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, scope_key)
);

alter table public.ui_preferences enable row level security;

-- 남의 설정은 읽지도 쓰지도 못한다. 개인 설정에 공유 개념이 없다.
drop policy if exists ui_preferences_own_select on public.ui_preferences;
create policy ui_preferences_own_select on public.ui_preferences
  for select using (auth.uid() = user_id);

drop policy if exists ui_preferences_own_upsert on public.ui_preferences;
create policy ui_preferences_own_upsert on public.ui_preferences
  for insert with check (auth.uid() = user_id);

drop policy if exists ui_preferences_own_update on public.ui_preferences;
create policy ui_preferences_own_update on public.ui_preferences
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists ui_preferences_own_delete on public.ui_preferences;
create policy ui_preferences_own_delete on public.ui_preferences
  for delete using (auth.uid() = user_id);

comment on table public.ui_preferences is
  '화면별 개인 UI 설정(view/size/sort만). 필터·검색어는 저장하지 않는다.';
