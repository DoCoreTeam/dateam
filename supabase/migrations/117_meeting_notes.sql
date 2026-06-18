-- 117_meeting_notes.sql
-- 회의노트 기능 (가산적 — ADD only, 기존 데이터 변형 0).
-- 기획: docs/2026-06-17-v0.7.184-meeting-notes/01-architecture.md §2 안ⓑ (전용 테이블).
-- RLS·CHECK·트리거 스타일은 010_daily_logs / 051_calendar_events 차용.
-- 음성(transcript/audio_*)은 Phase 2이지만, 향후 무중단 ADD 대신 미리 nullable 컬럼으로 포함 (NOT NULL 강제 금지).

create table if not exists meeting_notes (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references profiles(id) on delete cascade,
  department_id      uuid references org_nodes(id),
  title              text not null,
  meeting_at         timestamptz,
  -- attendees: 참석자 이름 단순 목록. tags(text[])·leads.tags(TEXT[]) 기존 관례와 통일.
  --            구조화된 객체(역할/이메일)가 필요해지면 Phase 2에서 jsonb로 전환 검토.
  attendees          text[],
  body_html          text,                                   -- 리치텍스트(Tiptap) — 렌더는 공용 RichText 경유
  body_plain         text,                                   -- html→plain (lib/html-to-plain.ts). AI 입력·인용은 plain 사용
  summary            text,                                   -- AI 요약(생성형)
  decisions          text,                                   -- 결정사항
  transcript         text,                                   -- Phase2: 음성 전사 (nullable)
  audio_drive_id     text,                                   -- Phase2: Google Drive 파일 ID (nullable)
  audio_duration_sec int,                                    -- Phase2: 음성 길이(초) (nullable)
  tags               text[],
  status             text not null default 'draft' check (status in ('draft','final','archived')),
  deleted_at         timestamptz,                            -- 소프트삭제
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- 인덱스: 본인 목록(meeting_at desc 정렬) + 부서 필터. 활성행만(partial WHERE deleted_at IS NULL).
create index if not exists idx_meeting_notes_user_meeting
  on meeting_notes (user_id, meeting_at desc) where deleted_at is null;
create index if not exists idx_meeting_notes_dept
  on meeting_notes (department_id) where deleted_at is null;

-- updated_at 자동 갱신: 공용 touch 함수가 없어(051은 fn_cal_touch 전용) 동일 스타일로 전용 함수 생성.
create or replace function fn_meeting_notes_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_meeting_notes_touch on meeting_notes;
create trigger trg_meeting_notes_touch before update on meeting_notes
for each row execute function fn_meeting_notes_touch();

alter table meeting_notes enable row level security;

-- SELECT: 본인 OR admin. (010_daily_logs 패턴)
-- 확장지점: org-scope 계층 공유는 MVP 미적용. 향후 calendar_events(051)처럼
--   private.hierarchy_enabled()/my_readable_user_ids()/is_executive() 조건을 OR로 추가.
drop policy if exists meeting_notes_select on meeting_notes;
create policy meeting_notes_select on meeting_notes
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
        and p.deleted_at is null
    )
  );

-- INSERT: 본인만
drop policy if exists meeting_notes_insert on meeting_notes;
create policy meeting_notes_insert on meeting_notes
  for insert with check (user_id = auth.uid());

-- UPDATE: 본인만 (소프트삭제는 deleted_at UPDATE)
drop policy if exists meeting_notes_update on meeting_notes;
create policy meeting_notes_update on meeting_notes
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- DELETE: 본인만 (하드삭제 경로 — 통상은 소프트삭제 UPDATE 사용)
drop policy if exists meeting_notes_delete on meeting_notes;
create policy meeting_notes_delete on meeting_notes
  for delete using (user_id = auth.uid());

-- daily_logs ← meeting_notes 추출 출처 추적. promoted_from_log_id(104) 선례와 동일 스타일.
alter table daily_logs
  add column if not exists meeting_note_id uuid references meeting_notes(id) on delete set null;
create index if not exists idx_daily_logs_meeting_note
  on daily_logs(meeting_note_id) where meeting_note_id is not null;

-- calendar_events.link_kind CHECK에 'meeting' 추가.
-- 인라인 CHECK의 Postgres 자동 제약명 = <table>_<column>_check (032/080 선례 확인).
-- 기존 값('daily','weekly','memo') 보존 — 데이터 영향 0.
alter table calendar_events drop constraint if exists calendar_events_link_kind_check;
alter table calendar_events add constraint calendar_events_link_kind_check
  check (link_kind in ('daily','weekly','memo','meeting'));
