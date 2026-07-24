-- 176 — 목록 심층분석 완전 대화형: 항목별 다회차 대화 영속 (R2, docs/2026-07-24-v0.7.378-...).
-- 각 의미블록(항목)에 대해 사용자↔AI가 다회차로 주고받은 지시·응답을 보존한다.
-- 항목 최종 확정본은 기존 ai_analysis_items.result_text에 스냅샷(종합·export가 그대로 읽음 — 무변경 호환).
create table if not exists ai_analysis_item_messages (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references ai_analysis_sessions(id) on delete cascade,
  item_idx   integer not null,
  revision   integer not null default 1,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  seq        integer not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_aaim_lookup
  on ai_analysis_item_messages (session_id, item_idx, revision, seq);

alter table ai_analysis_item_messages enable row level security;

-- owner-only(세션 소유권 기반, 157 패턴). 서버액션은 admin 클라이언트라 RLS 우회하나 방어심층으로 둔다.
drop policy if exists aaim_owner on ai_analysis_item_messages;
create policy aaim_owner on ai_analysis_item_messages for all
  using (exists (select 1 from ai_analysis_sessions s where s.id = session_id and s.user_id = auth.uid()))
  with check (exists (select 1 from ai_analysis_sessions s where s.id = session_id and s.user_id = auth.uid()));
