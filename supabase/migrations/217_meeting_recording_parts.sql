-- 217_meeting_recording_parts.sql
-- 회의 녹음 구간 + 전사 세그먼트 (신설 — 기존 표 변형 0)
--
-- 왜 "구간"인가: 세 제약이 동시에 걸린다.
--   ① Vercel 요청 본문 4.5MB  — 60분 녹음(≈14MB)은 우리 API를 통과할 수 없다
--   ② 함수 실행 300초         — 60분 오디오를 한 번에 전사하면 넘는다
--   ③ AI 출력 32,768토큰      — 60분 한국어 전사는 4~6만 토큰이라 중간에서 잘린다
-- 10분 구간이면 2~3MB / 3초 / 8~12k 토큰이라 셋 다 안에 들어온다.
--
-- 그리고 MediaRecorder 의 timeslice 조각은 **첫 조각에만 헤더가 있어** 단독 전사가 안 된다.
-- 10분마다 레코더를 다시 시작하면 구간마다 완결된 파일이 나온다 — 그래서 이 표가 구간 단위다.
--
-- 오디오 자체는 우리 구글드라이브에 둔다(마이그 117 이 예약해 둔 audio_drive_id 와 같은 방식).

create table if not exists meeting_recording_part (
  id               uuid primary key default gen_random_uuid(),
  note_id          uuid not null references meeting_notes(id) on delete cascade,
  part_idx         int  not null,                 -- 0부터. 전체 시간축 오프셋 = part_idx × 10분
  drive_file_id    text,                          -- Google Drive 파일 ID
  mime             text not null default 'audio/webm',
  duration_sec     int,
  status           text not null default 'UPLOADED'
                   check (status in ('UPLOADED','TRANSCRIBING','TRANSCRIBED','FAILED')),
  error            text,
  retry_count      int  not null default 0,
  -- 잡 락 회수용. CRM 쪽 녹음 표에는 이게 없어서 멈춘 작업을 되살릴 방법이 없었다.
  claimed_at       timestamptz,
  -- 자동삭제 흔적. drive_file_id 를 지우지 않고 이 값을 찍는다 —
  -- 그래야 "왜 재생이 안 되지"에 답할 수 있다.
  audio_deleted_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (note_id, part_idx)
);

create index if not exists idx_meeting_part_note on meeting_recording_part (note_id, part_idx);
-- 전사 잡이 집어 갈 것을 찾는 경로. 대기·진행 중만 본다.
create index if not exists idx_meeting_part_pending
  on meeting_recording_part (status, claimed_at)
  where status in ('UPLOADED', 'TRANSCRIBING');
-- 자동삭제 잡이 훑는 경로: 전사 성공했고 아직 안 지운 것만.
create index if not exists idx_meeting_part_purgeable
  on meeting_recording_part (created_at)
  where status = 'TRANSCRIBED' and audio_deleted_at is null and drive_file_id is not null;

create or replace function fn_meeting_part_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_meeting_part_touch on meeting_recording_part;
create trigger trg_meeting_part_touch before update on meeting_recording_part
for each row execute function fn_meeting_part_touch();

-- 전사 세그먼트 — 5축 추출이 "어느 대목에서 읽었는지"를 대는 단위다.
-- start_ms 에는 구간 오프셋이 이미 더해진 값이 들어간다(전체가 하나의 시간축).
create table if not exists meeting_transcript_segment (
  id       uuid primary key default gen_random_uuid(),
  part_id  uuid not null references meeting_recording_part(id) on delete cascade,
  idx      int  not null,
  speaker  text not null,
  start_ms int  not null,
  end_ms   int  not null,
  text     text not null,
  unique (part_id, idx),
  constraint meeting_segment_span_chk check (end_ms > start_ms)
);

create index if not exists idx_meeting_segment_part on meeting_transcript_segment (part_id, idx);

-- RLS: 부모(회의노트)의 권한을 그대로 따른다. 공개 범위(216)도 자동으로 따라온다 —
-- 여기에 규칙을 다시 쓰면 두 벌이 되고, 한쪽만 고치는 날이 온다.
alter table meeting_recording_part enable row level security;
alter table meeting_transcript_segment enable row level security;

drop policy if exists meeting_part_select on meeting_recording_part;
create policy meeting_part_select on meeting_recording_part
  for select using (
    exists (select 1 from meeting_notes n where n.id = meeting_recording_part.note_id)
  );

drop policy if exists meeting_segment_select on meeting_transcript_segment;
create policy meeting_segment_select on meeting_transcript_segment
  for select using (
    exists (
      select 1 from meeting_recording_part p
      where p.id = meeting_transcript_segment.part_id
    )
  );

-- 쓰기는 전부 서버(service_role) 경유다. 브라우저가 직접 쓰는 경로를 열지 않는다 —
-- 구간 상태는 잡이 정하는 값이라 사람이 바꾸면 전사가 꼬인다.

-- 117 이 예약해 둔 자리를 채운다: 구간별 파일 id 는 위 표가 갖고,
-- audio_drive_id 에는 첫 구간 id 를 넣어 기존 컬럼의 의미를 깨지 않는다.
comment on column meeting_notes.audio_drive_id is
  '첫 녹음 구간의 Drive 파일 ID(하위호환). 구간별 id 는 meeting_recording_part.drive_file_id 참조.';
