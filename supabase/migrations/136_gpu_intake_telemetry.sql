-- 136_gpu_intake_telemetry.sql
-- 통합입력 파싱 관측(Observability) 레이어 — 사용자가 업로드했을 때 (1)원본이 어땠고
--   (2)결과를 어떻게 냈고 (3)오류면 어느 단계서 왜 났는지를 구조화 적재해 사후 재현·진단.
--   "무음 드롭/오염"이 쿼리 가능한 증거가 됨(그동안 매번 수동 추적하던 걸 자동 수집).
-- 설계결정(사용자 2026-06-25): 전부 full 트레이스 / 원본 그리드는 Drive JSON(여기엔 fileId만) /
--   1차 계측 = 프로덕션 경로(stream·commit) / PII(담당자 이메일·연락처)는 원본 보존 + RLS admin-only.
-- 멱등: create table if not exists. RLS: 적재=service_role(서버), 읽기=admin 전용(PII 보호).
-- 비차단 원칙: 적재 실패가 추출 흐름을 절대 막지 않음(앱단 fire-and-forget, token-logger 패턴).

-- ── 부모: 업로드/제출 1회 = 1 run ──
CREATE TABLE IF NOT EXISTS gpu_intake_runs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NULL,
  channel                text NOT NULL,                 -- xlsx|img|pdf|catalog|own|market_link|text
  source_filename        text NULL,
  source_mime            text NULL,
  source_bytes           integer NULL,
  raw_input_hash         text NULL,                     -- 식별/중복
  evidence_drive_file_id text NULL,                     -- 원본파일 Drive(기존 evidence-store 재사용)
  raw_grid_drive_file_id text NULL,                     -- AI에 보낸 그리드 스냅샷 JSON(Drive). DB엔 fileId만.
  prompt_versions        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_models              jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                 text NOT NULL DEFAULT 'running' -- running|succeeded|partial|failed
                           CHECK (status IN ('running','succeeded','partial','failed')),
  counts                 jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {source_rows,transcribed,extracted,resolved,held,blocked,confirmed,truncated}
  error_code             text NULL,
  error_summary          text NULL,
  started_at             timestamptz NOT NULL DEFAULT now(),
  finished_at            timestamptz NULL,
  duration_ms            integer NULL,
  is_test                boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- ── 자식: 행 × 단계 = 1 이벤트 ──
CREATE TABLE IF NOT EXISTS gpu_intake_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES gpu_intake_runs(id) ON DELETE CASCADE,
  row_ref         text NULL,                            -- 원본 좌표(예 sheet1!C92)
  stage           text NOT NULL,                        -- upload|grid_compress|transcribe|classify|extract|normalize_money|canonical_model|resolve_product|gate_confidence|gate_validate|dedup|commit
  status          text NOT NULL                         -- ok|warn|held|dropped|overwritten|error
                    CHECK (status IN ('ok','warn','held','dropped','overwritten','error')),
  input_snapshot  jsonb NULL,                           -- 단계 진입값
  output_snapshot jsonb NULL,                           -- 단계 산출값
  reason_code     text NULL,                            -- model_unresolved|unparseable_price|no_price_blocked|slice_truncated|key_mangled|supplier_missing|dup_merged
  reason_detail   text NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gir_user_created ON gpu_intake_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gir_status ON gpu_intake_runs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gie_run_status ON gpu_intake_events (run_id, status);
CREATE INDEX IF NOT EXISTS idx_gie_reason ON gpu_intake_events (reason_code) WHERE reason_code IS NOT NULL;

COMMENT ON TABLE gpu_intake_runs IS '통합입력 1회 처리 관측 — 원본·결과 counts·오류. reason_code 집계로 최다 실패원인 도출.';
COMMENT ON TABLE gpu_intake_events IS '통합입력 행×단계 관측 — 어느 단계서 무엇이 드롭/오염/거부됐는지 증거(무음 금지).';

-- RLS: 적재=service_role, 읽기=admin 전용(원본에 담당자 PII 포함 가능)
ALTER TABLE gpu_intake_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gir_service_write ON gpu_intake_runs;
CREATE POLICY gir_service_write ON gpu_intake_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS gir_admin_read ON gpu_intake_runs;
CREATE POLICY gir_admin_read ON gpu_intake_runs FOR SELECT TO authenticated USING (public.is_admin());

ALTER TABLE gpu_intake_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gie_service_write ON gpu_intake_events;
CREATE POLICY gie_service_write ON gpu_intake_events FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS gie_admin_read ON gpu_intake_events;
CREATE POLICY gie_admin_read ON gpu_intake_events FOR SELECT TO authenticated USING (public.is_admin());

-- 롤백: DROP TABLE IF EXISTS gpu_intake_events; DROP TABLE IF EXISTS gpu_intake_runs;
