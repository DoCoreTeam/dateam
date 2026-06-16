-- 106: autolink 사전계산 큐 (저장시 enqueue → 워커가 비동기 runAutolink)
--  설계: docs/2026-06-16-v0.7.157-autolink-queue/01-architecture.md
--  일일업무 저장 시 autolink를 백그라운드로 미리 계산 → 패널 열람 체감지연 제거.
--  멱등(IF NOT EXISTS / DROP POLICY IF EXISTS). 잡은 하드삭제 OK(soft-delete 불요).
--  RLS default-deny: 소유자 SELECT만. INSERT/UPDATE/DELETE 정책 미부여 = service_role 전용
--  (워커·enqueue 라우트는 admin client로 RLS 우회). 패턴은 101/102 autolink와 동일.

-- 1) 큐 테이블
CREATE TABLE IF NOT EXISTS autolink_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id       uuid NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL,                       -- 소유자(runAutolink 범위·소유자 SELECT용)
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'processing', 'done', 'error')),
  attempts     int  NOT NULL DEFAULT 0,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (log_id)                                   -- 로그당 1잡(저장시 upsert)
);

-- 워커 폴링용: pending을 created_at 오름차순(FIFO)으로 선점
CREATE INDEX IF NOT EXISTS idx_autolink_jobs_status ON autolink_jobs(status, created_at);

-- 2) updated_at 자동 갱신 트리거 (공통 헬퍼 set_updated_at() 재사용 — 001에 정의됨)
DROP TRIGGER IF EXISTS trg_autolink_jobs_updated_at ON autolink_jobs;
CREATE TRIGGER trg_autolink_jobs_updated_at
  BEFORE UPDATE ON autolink_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3) RLS — default-deny. 소유자 본인 잡만 조회. 쓰기 정책 미부여(=service_role 전용).
ALTER TABLE autolink_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS autolink_jobs_select ON autolink_jobs;
CREATE POLICY autolink_jobs_select ON autolink_jobs FOR SELECT TO authenticated
  USING (requester_id = (SELECT auth.uid()));
-- INSERT/UPDATE/DELETE: 정책 없음 → authenticated 거부. enqueue/워커는 service_role(admin client)로 수행.

-- 4) 동시성 안전 선점 RPC — 워커가 pending N개를 FOR UPDATE SKIP LOCKED로 잠가
--    status='processing'·attempts+1로 전이한 뒤 그 행을 반환(중복처리·경합 방지).
--    service_role(워커)만 호출. SECURITY DEFINER + search_path 고정(인젝션 방지).
CREATE OR REPLACE FUNCTION claim_autolink_jobs(p_limit int)
RETURNS TABLE (id uuid, log_id uuid, requester_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH picked AS (
    SELECT j.id
    FROM autolink_jobs j
    -- attempts < 5 (MAX_ATTEMPTS 상수): 상한 도달 잡은 영구 제외 → 폭주/무한재시도 방지.
    --   (transient 실패는 error로 남아 재처리될 수 있으나, attempts가 5에 도달하면 다시 선점되지 않음.)
    WHERE j.status = 'pending' AND j.attempts < 5
    ORDER BY j.created_at ASC
    LIMIT GREATEST(COALESCE(p_limit, 1), 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE autolink_jobs j
  SET status = 'processing',
      attempts = j.attempts + 1,
      updated_at = now()
  FROM picked
  WHERE j.id = picked.id
  RETURNING j.id, j.log_id, j.requester_id;
$$;

REVOKE ALL ON FUNCTION claim_autolink_jobs(int) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION claim_autolink_jobs(int) TO service_role;
