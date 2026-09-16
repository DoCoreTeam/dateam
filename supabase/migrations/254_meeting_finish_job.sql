-- 254_meeting_finish_job.sql
-- 「미팅 끝내기」를 잡으로 남긴다 (신설 — 기존 표 변형 0)
--
-- ## 왜 필요한가 (실측 2026-09-14 「시티큐브 내부 미팅」)
--
-- 끝내기는 POST 하나가 정리와 5축을 잇달아 돌리고 브라우저를 최대 300초 붙잡았다.
-- 그 사이에 일어난 일:
--   · 07:55:43 끝난 시각 저장 → 08:00:38 정리본 저장(295초) → 300초 상한에 절단
--   · `crm_ai_run` 에 행 0건 = 5축은 모델을 부르던 중에 죽었고 **실패 기록조차 없다**
--   · 화면을 나가면 진행이 통째로 사라진다 — `crm_meeting` 에 진행 상태 칸이 없어서
--     돌아와도 「정리 중」을 말할 수 없고, 잠금이 없어 다시 누르면 두 번 돈다
--
-- 응답 뒤 실행을 보장할 방법이 이 저장소엔 없다(Next 14.2 에 after() 없음 —
-- app/api/ci/queue/drain/route.ts 참조). 그러니 일을 **다음 실행**으로 넘겨야 하고,
-- 넘기려면 넘길 것을 적어 둘 자리가 있어야 한다. 이 표가 그 자리다.
--
-- 모양은 전사 잡(217_meeting_recording_parts)을 그대로 따른다 — status·retry_count·
-- claimed_at·error. 선점은 RFP 잡(249_rfp_job_claim)의 `for update skip locked` 를 따른다.
-- 큐를 세 번째로 새로 설계하지 않는다.

create table if not exists crm_meeting_finish_job (
  id            uuid primary key default gen_random_uuid(),
  -- Prisma 표라 컬럼이 카멜케이스다. 여기는 새 표이므로 스네이크로 쓰되 FK 만 맞춘다
  meeting_id    text not null references crm_meeting(id) on delete cascade,
  workspace_id  text not null,
  -- 부른 사람. 5축이 「이 사람이 그 노트를 볼 수 있나」를 판정하는 데 쓴다
  actor_id      text,
  host_user_id  uuid,

  status        text not null default 'QUEUED'
                check (status in ('QUEUED','RUNNING','DONE','FAILED')),
  -- 다음에 할 일. 한 회차가 한 단계만 진행하고 그때마다 저장한다 —
  -- 도중에 끊겨도 앞 단계 결과가 남게 하려는 것이 이 칸의 전부다
  stage         text not null default 'DIGEST'
                check (stage in ('DIGEST','NOTE','EXTRACT','DONE')),
  -- 단계별 결과(FinishStep[]). 화면이 「무엇이 됐고 무엇이 안 됐는지」를 여기서 읽는다.
  -- 예전엔 이 값이 응답 본문에만 있어서 화면을 나가면 통째로 사라졌다
  steps         jsonb not null default '[]'::jsonb,
  error         text,
  retry_count   int  not null default 0,
  claimed_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  finished_at   timestamptz
);

-- **미팅당 미완 잡은 하나뿐이다.** 두 번 눌러도 두 번 돌지 않게 하는 것이 이 인덱스다.
-- 부분 유니크라 끝난 잡은 몇 개든 쌓인다(이력이 지워지면 왜 그랬는지 답할 수 없다).
create unique index if not exists idx_finish_job_one_open
  on crm_meeting_finish_job (meeting_id)
  where status in ('QUEUED', 'RUNNING');

-- 드레인이 집어 갈 것을 찾는 경로
create index if not exists idx_finish_job_pending
  on crm_meeting_finish_job (status, claimed_at)
  where status in ('QUEUED', 'RUNNING');

-- 화면이 「이 미팅의 마지막 잡」을 읽는 경로
create index if not exists idx_finish_job_meeting
  on crm_meeting_finish_job (meeting_id, created_at desc);

create or replace function fn_finish_job_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_finish_job_touch on crm_meeting_finish_job;
create trigger trg_finish_job_touch before update on crm_meeting_finish_job
for each row execute function fn_finish_job_touch();

/*
  잡을 집어 온다 — **고르는 것과 잠그는 것이 한 문장이라야 한다.**

  「골라서 → 갱신」 두 번으로 나누면 그 사이에 남이 집어 간다. 워커가 둘(브라우저와 크론)이라
  그 틈이 실제로 열린다. `for update skip locked` 는 그 틈이 없다(249 와 같은 이유).

  임대 만료를 여기서 함께 본다: 집어 간 워커가 죽으면 `claimed_at` 이 남아 잡이 영원히
  잠긴다. 되살리는 곳과 시도를 세는 곳이 갈리면 상한이 안 먹으므로 한 문장에 둔다.
*/
create or replace function crm_claim_finish_jobs(
  p_limit        int default 1,
  p_lease_sec    int default 300,
  p_max_attempts int default 3
)
returns setof crm_meeting_finish_job
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update crm_meeting_finish_job j
     set status      = 'RUNNING',
         claimed_at  = now(),
         retry_count = j.retry_count + 1,
         error       = null
   where j.id in (
     select c.id
       from crm_meeting_finish_job c
      where c.retry_count < p_max_attempts
        and (
          c.status = 'QUEUED'
          -- 임대가 끊긴 좀비 — 집어 간 워커가 돌아오지 않았다
          or (c.status = 'RUNNING'
              and c.claimed_at is not null
              and c.claimed_at < now() - make_interval(secs => p_lease_sec))
        )
      order by c.created_at asc
      for update skip locked
      limit greatest(1, p_limit)
   )
  returning j.*;
end;
$$;

-- 시도 상한을 넘겨 더는 집히지 않는 잡은 실패로 못 박는다 — QUEUED 로 남겨 두면
-- 화면이 영원히 「기다리는 중」이라고 말한다. 그게 오늘 사용자가 본 화면이다
create or replace function crm_expire_finish_jobs(p_max_attempts int default 3)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update crm_meeting_finish_job
     set status      = 'FAILED',
         finished_at = now(),
         error       = coalesce(error, '여러 번 시도했지만 정리하지 못했어요.')
   where status in ('QUEUED', 'RUNNING')
     and retry_count >= p_max_attempts;
  get diagnostics n = row_count;
  return n;
end;
$$;

alter table crm_meeting_finish_job enable row level security;

-- 읽기는 같은 워크스페이스의 CRM 구성원만. 쓰기는 전부 서버(service_role) 경유다 —
-- 잡 상태는 드레인이 정하는 값이라 사람이 바꾸면 단계가 꼬인다
drop policy if exists finish_job_select on crm_meeting_finish_job;
create policy finish_job_select on crm_meeting_finish_job
  for select using (
    exists (
      select 1 from crm_member m
      where m."workspaceId" = crm_meeting_finish_job.workspace_id
        and m."hostUserId" = auth.uid()::text
        and m."deletedAt" is null
    )
  );
