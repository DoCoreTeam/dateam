-- 249_rfp_job_claim.sql
--
-- 작업 선점 — SKIP LOCKED (설계서 3.5.2)
--
-- ## 왜 SQL 이라야 하나
--
-- 워커가 여럿이면 «같은 잡을 둘이 집어 가는» 일이 반드시 생긴다.
-- 애플리케이션에서 「골라서 → 갱신」 두 번에 나누면 그 사이에 남이 집어 간다.
-- `for update skip locked` 는 **고르는 것과 잠그는 것이 한 문장**이라 그 틈이 없다.
--
-- ## 재시도 상한을 여기 두는 이유
--
-- 상한을 애플리케이션에만 두면, 워커가 죽어 잠금이 남은 잡이 다시 큐로 돌아올 때
-- 상한이 적용되지 않는다. 되살리는 곳과 세는 곳이 같아야 한다.

-- 잡 하나 이상을 집어 온다. 집는 즉시 running 이 되고 시도 횟수가 오른다
create or replace function rfp_claim_jobs(
  p_worker       text,
  p_limit        int  default 1,
  p_max_attempts int  default 3,
  p_job_types    text[] default null
)
returns setof rfp_analysis_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update rfp_analysis_jobs j
     set status    = 'running',
         locked_by = p_worker,
         locked_at = now(),
         attempts  = j.attempts + 1,
         error     = null
   where j.id in (
     select c.id
       from rfp_analysis_jobs c
      where c.status = 'queued'
        and c.attempts < p_max_attempts
        and (p_job_types is null or c.job_type = any(p_job_types))
      -- 급한 것 먼저, 같으면 오래된 것 먼저
      order by c.priority asc, c.created_at asc
      for update skip locked
      limit greatest(1, p_limit)
   )
  returning j.*;
end $$;

-- 끝났다고 표시한다. 이미 done 인 잡을 다시 끝내도 아무 일이 없다(멱등)
create or replace function rfp_finish_job(p_job_id uuid, p_progress jsonb default '{}')
returns rfp_analysis_jobs
language plpgsql
security definer
set search_path = public
as $$
declare r rfp_analysis_jobs;
begin
  update rfp_analysis_jobs
     set status = 'done', finished_at = now(), locked_by = null, locked_at = null,
         progress = coalesce(p_progress, '{}'::jsonb), error = null
   where id = p_job_id
  returning * into r;
  return r;
end $$;

-- 실패를 기록한다. 상한을 넘겼으면 dead 로 두고 다시 안 집는다 —
-- queued 로 되돌리면 같은 실패를 영원히 반복한다
create or replace function rfp_fail_job(p_job_id uuid, p_error text, p_max_attempts int default 3)
returns rfp_analysis_jobs
language plpgsql
security definer
set search_path = public
as $$
declare r rfp_analysis_jobs;
begin
  update rfp_analysis_jobs
     set status = case when attempts >= p_max_attempts then 'dead' else 'queued' end,
         error = p_error,
         locked_by = null,
         locked_at = null,
         finished_at = case when attempts >= p_max_attempts then now() else null end
   where id = p_job_id
  returning * into r;
  return r;
end $$;

-- 워커가 죽어 잠금만 남은 잡을 되살린다.
-- 상한을 넘긴 것은 되살리지 않는다 — 되살리면 죽은 잡이 큐를 영원히 돈다
create or replace function rfp_reap_stale_jobs(p_older_than interval default interval '15 minutes',
                                               p_max_attempts int default 3)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update rfp_analysis_jobs
     set status = case when attempts >= p_max_attempts then 'dead' else 'queued' end,
         locked_by = null, locked_at = null,
         error = coalesce(error, '워커 응답 없음')
   where status = 'running'
     and locked_at is not null
     and locked_at < now() - p_older_than;
  get diagnostics n = row_count;
  return n;
end $$;

-- 잡 넣기 — 같은 단계를 두 번 걸지 않는다.
-- dedupe_key 가 이미 있으면 새로 만들지 않고 있던 잡을 돌려준다
create unique index if not exists uq_rfp_jobs_dedupe
  on rfp_analysis_jobs (dedupe_key) where dedupe_key is not null and status in ('queued','running');

create or replace function rfp_enqueue_job(
  p_org_id     uuid,
  p_case_id    uuid,
  p_job_type   text,
  p_payload    jsonb default '{}',
  p_priority   int default 5,
  p_dedupe_key text default null
)
returns rfp_analysis_jobs
language plpgsql
security definer
set search_path = public
as $$
declare r rfp_analysis_jobs;
begin
  if p_dedupe_key is not null then
    select * into r from rfp_analysis_jobs
     where dedupe_key = p_dedupe_key and status in ('queued','running')
     limit 1;
    if found then return r; end if;
  end if;

  insert into rfp_analysis_jobs (org_id, case_id, job_type, payload, priority, dedupe_key)
  values (p_org_id, p_case_id, p_job_type, coalesce(p_payload, '{}'::jsonb), p_priority, p_dedupe_key)
  returning * into r;
  return r;
end $$;
