-- 218_system_events.sql — 관리자가 읽는 시스템 사건 한 곳
--
-- 왜 새 표를 만드나: 실패가 나는 자리는 8곳인데 **5곳은 테이블 자체가 없다**(전부 console.error, 186곳).
--   없는 것은 UNION 할 수 없다. 그래서 사람이 읽는 사건을 모으는 싱크를 하나 만든다.
--
-- 기존 표를 대체하지 않는다. 판정 기준은 한 줄이다 — "지우면 무엇이 망가지나":
--   ai_token_logs · crm_ai_run · ci_jobs = 도메인 진실(정산·재시도·감사) → 지우면 시스템이 망가진다
--   system_events                        = 사람이 읽는 사건            → 지워도 아무것도 안 망가진다(90일 보존)
--
-- 숫자(정산) 층과 문장(무슨 일이 있었나) 층이라 중복이 아니라 역할이 다르다.

CREATE TABLE IF NOT EXISTS system_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at   timestamptz NOT NULL DEFAULT now(),

  -- 묶음의 열쇠. 같은 지문은 화면에서 한 줄로 접힌다("오늘 21:34부터 12번")
  fingerprint   text NOT NULL,

  source        text NOT NULL,   -- host_ai | crm_ai | crm_api | host_api | ci_job | crm_job | cron | client
  severity      text NOT NULL,   -- critical | error | warn
  reason        text NOT NULL,   -- quota | auth | timeout | network | server | bad_json | db | config | unknown

  feature       text,            -- 사용자가 부르는 이름("회사 정보 AI 보강")
  route         text,            -- '/crm/companies'
  actor_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  workspace_id  uuid,

  -- 사실 문장은 **저장 시점에 확정한다.** 나중에 코드가 바뀌어도 그때 무슨 일이었는지가 남는다.
  headline      text NOT NULL,
  detail        text NOT NULL,

  raw           text,            -- 원문(2000자 절단). 접어서 보여준다 — 감추지 않는다
  context       jsonb NOT NULL DEFAULT '{}'::jsonb,

  resolved_at   timestamptz,
  resolved_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_system_events_recent      ON system_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_fingerprint ON system_events (fingerprint, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_open        ON system_events (severity, occurred_at DESC) WHERE resolved_at IS NULL;

ALTER TABLE system_events ENABLE ROW LEVEL SECURITY;

-- 읽기는 어드민만 (011_ai_token_logs 의 정책을 그대로 따른다)
DROP POLICY IF EXISTS "admin_read_system_events" ON system_events;
CREATE POLICY "admin_read_system_events" ON system_events
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- 어드민이 '처리함'을 누른다
DROP POLICY IF EXISTS "admin_update_system_events" ON system_events;
CREATE POLICY "admin_update_system_events" ON system_events
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- 쓰기는 service role (adminClient) 만 — RLS 우회
DROP POLICY IF EXISTS "service_insert_system_events" ON system_events;
CREATE POLICY "service_insert_system_events" ON system_events
  FOR INSERT WITH CHECK (true);


-- AI 해결책은 **지문당 한 벌**이다. 사건마다가 아니다 —
-- 같은 오류 500건에 AI 를 500번 부르면 그 자체가 다음 한도 초과의 원인이 된다.
CREATE TABLE IF NOT EXISTS system_event_remedies (
  fingerprint   text PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  model         text,
  confidence    text NOT NULL,   -- high | low | unknown — 모르면 모른다고 한다
  body          jsonb NOT NULL,  -- { diagnosis, checks[], actions[], files[] }
  -- AI 없이 우리가 미리 쓴 답인가. 한도 사유에는 AI 를 안 부른다(또 실패한다) — 그때 이게 답한다
  is_playbook   boolean NOT NULL DEFAULT false
);

ALTER TABLE system_event_remedies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read_remedies" ON system_event_remedies;
CREATE POLICY "admin_read_remedies" ON system_event_remedies
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "service_write_remedies" ON system_event_remedies;
CREATE POLICY "service_write_remedies" ON system_event_remedies
  FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE system_events IS
  '관리자가 읽는 시스템 사건. 도메인 진실이 아니라 사람이 읽는 문장 층이다(90일 보존).';
