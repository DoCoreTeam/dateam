-- 221_meeting_note_digest.sql
-- 회의 정리본 — **버전으로 쌓는다** (신설 · 기존 표 변형 0)
--
-- **왜 표를 만드나.** 지금은 정리 결과를 `meeting_notes.summary`/`decisions` 에 **덮어쓴다.**
-- 두 번 돌리면 첫 결과가 사라진다. 회의록은 되돌릴 수 없는 자산이라 이건 위험하다.
-- 이 저장소는 같은 문제를 주간보고에서 이미 겪었고 `weekly_report_snapshots` 로 풀었다 —
-- 같은 방식을 쓴다.
--
-- **왜 지금 필요한가.** v0.7.592 부터 정리가 **메모 + 녹음 전사**를 함께 읽는다.
-- 입력이 둘이 되면 "무엇을 읽고 만든 결과인지"가 결과만큼 중요해진다.
-- 그래서 `sources` 에 그때 읽은 것을 함께 남긴다 — 안 남기면 왜 이런 정리가 나왔는지 못 댄다.
--
-- **`meeting_notes.summary` 는 계속 채운다.** 최신 정리본의 평문 사본이다.
-- 그걸 읽는 소비처가 여섯 곳(발행 스냅샷·목록 배지·내보내기 등)이라 끊으면 그쪽이 조용히 빈다.
-- 이 표는 **이력**이고, 저 컬럼은 **지금 값**이다.
--
-- 관계 계약(R-1): 회의노트 → 정리본 = **소유(owns)**. 노트가 사라지면 정리본도 존재 이유가 없다.

create table if not exists meeting_note_digest (
  id           uuid primary key default gen_random_uuid(),
  note_id      uuid not null references meeting_notes(id) on delete cascade,
  -- 1부터. 사람이 "3번째 정리"라고 부를 수 있는 번호다(uuid 로는 순서를 못 센다)
  seq          int  not null,
  -- 안건 구조 그대로. { agenda: [{ title, facts: [{ text, origin, segmentIds? }] }], conflicts: [...] }
  -- 사실마다 origin(memo|transcript|both)이 붙는다 — 이게 "별도로 두고 합친다"의 실체다
  agenda_json  jsonb not null,
  decisions    text,
  -- 무엇을 읽고 만들었나. { memoChars, transcriptSegments, partIds[] }
  -- 없으면 "왜 이 정리가 이런가"에 답할 수 없다
  sources      jsonb not null default '{}'::jsonb,
  model        text,
  created_at   timestamptz not null default now(),
  unique (note_id, seq)
);

-- 최신 정리본을 뽑는 경로(화면이 매번 부른다)
create index if not exists idx_meeting_digest_note on meeting_note_digest (note_id, seq desc);

comment on table meeting_note_digest is
  '회의 정리본 이력. 최신 1건의 평문 사본은 meeting_notes.summary/decisions 에 계속 유지된다(소비처 6곳).';
comment on column meeting_note_digest.agenda_json is
  '안건·사실 구조. 사실마다 origin(memo/transcript/both)과 근거 segmentIds 를 갖는다.';
comment on column meeting_note_digest.sources is
  '이 정리를 만들 때 읽은 것: memoChars · transcriptSegments · partIds. 재현·감사용.';

alter table meeting_note_digest enable row level security;

-- RLS: 부모(회의노트)의 권한을 그대로 따른다. 여기에 규칙을 다시 쓰면 두 벌이 되고,
-- 마이그 216·220 에서 공개 범위를 고칠 때 한쪽만 고치게 된다(실제로 그 사고가 있었다).
drop policy if exists meeting_digest_select on meeting_note_digest;
create policy meeting_digest_select on meeting_note_digest
  for select using (
    exists (select 1 from meeting_notes n where n.id = meeting_note_digest.note_id)
  );

-- 쓰기는 서버(service_role) 경유다. seq 를 브라우저가 정하면 동시 실행에서 번호가 겹친다.
