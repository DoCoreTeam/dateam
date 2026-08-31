-- 239_ci_signal_candidates.sql
--
-- 「이슈」를 사람이 손으로 적는 메모장에서 **AI가 모아 오고 사람이 확정하는 후보함**으로 바꾼다.
--
-- 배경(실측 2026-08-31): ci_signals 에 데이터가 들어오는 길은 화면의 입력폼 하나뿐이었고,
-- 그 결과 이슈는 1건이었다(같은 시점 게시물 1,709건 · 성공 공식 617건).
-- 트렌드 4탭 중 바깥 세상을 다루는 탭이 이슈 하나인데, 하필 그것만 자동이 없었다.
--
-- 설계 원칙 셋:
--   ① **자동 등록하지 않는다.** 추출·제안형 AI는 후보를 보여주고 사람이 확정한다
--      (CLAUDE.md §5-3). 일일업무 AI 후보·CRM 인박스가 전부 이 모양이다.
--   ② **출처 없는 후보는 만들지 않는다.** 근거 URL 이 없으면 확인할 방법이 없고,
--      확인할 수 없는 목록은 아무도 안 본다(CRM 회사 보강과 같은 규칙).
--   ③ **같은 주소는 한 번만.** 같은 사건이 여러 매체에 뜨므로 막지 않으면 한 사건이 5줄이 된다.

-- ── ① 후보/확정 상태 ────────────────────────────────────────────
-- 이미 있던 행은 사람이 손으로 넣은 것이라 확정본이다 → default 'confirmed' 가 그대로 맞다.
alter table ci_signals
  add column if not exists status       text not null default 'confirmed',
  add column if not exists confidence   numeric(4,3),
  add column if not exists evidence     jsonb not null default '{}',
  add column if not exists collected_at timestamptz,
  add column if not exists query        text,
  add column if not exists dedupe_key   text,
  add column if not exists created_by   uuid references profiles(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ci_signals_status_check'
  ) then
    alter table ci_signals
      add constraint ci_signals_status_check
      check (status in ('candidate', 'confirmed', 'dismissed'));
  end if;
end $$;

-- ── ② 중복 차단 ────────────────────────────────────────────────
-- 부분 유니크: 주소를 못 얻은 수기 입력(dedupe_key null)은 막지 않는다.
create unique index if not exists uq_ci_signals_dedupe
  on ci_signals (workspace_id, dedupe_key) where dedupe_key is not null;

-- 후보함은 «확인 대기»부터 본다.
create index if not exists idx_ci_signals_status_time
  on ci_signals (workspace_id, status, occurred_at desc);

-- ── ③ 언제 마지막으로 훑었나 ───────────────────────────────────
-- 채널 재훑기(ci_channels.last_sweep_at)와 같은 모양이다. 이게 없으면
-- 「후보 0건」이 «정말 조용했다»인지 «우리가 아직 안 봤다»인지 구분되지 않는다.
alter table ci_workspaces
  add column if not exists last_signal_sweep_at timestamptz;

-- ── ④ 삭제 계약 (R-1/R-3) ──────────────────────────────────────
-- ci_board_items·ci_jobs 는 폴리모픽이라 FK 를 걸 수 없다 → DB 트리거가 지운다.
-- 코드에만 맡기면 잊는다(2026-08-18: 손으로 치운 고아가 하루 만에 다시 생겼다).
create or replace function ci_purge_refs_of_signal() returns trigger
language plpgsql as $$
begin
  delete from ci_jobs where target_type = 'signal' and target_id = old.id;
  delete from ci_board_items where item_type = 'signal' and item_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_ci_purge_signal_refs on ci_signals;
create trigger trg_ci_purge_signal_refs
  before delete on ci_signals
  for each row execute function ci_purge_refs_of_signal();

-- ── ⑤ RLS ──────────────────────────────────────────────────────
-- 지금까지 select 정책만 있었다. 쓰기는 서비스롤(앱 게이트)로만 들어왔지만,
-- 정책을 비워 두면 다음 사람이 클라이언트에서 직접 쓰려다 조용히 막힌다.
drop policy if exists ci_signals_write on ci_signals;
create policy ci_signals_write on ci_signals for all
  using (ci_is_member(workspace_id))
  with check (ci_is_member(workspace_id));

comment on column ci_signals.status is
  'candidate=AI가 찾아온 확인 대기 / confirmed=사람이 확정 / dismissed=사람이 버림';
comment on column ci_signals.dedupe_key is
  '같은 사건을 한 번만 담기 위한 열쇠. 정규화한 주소(호스트+경로), 주소가 없으면 null';
