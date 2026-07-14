-- =============================================================================
-- 156_ai_model_catalog.sql
-- AI 채팅 ⑤ 모델 선택 모달 — DB 캐시 기반 모델 카탈로그(능력·출시일 표시)
-- RLS: SELECT는 인증된 admin만(다른 admin 전용 테이블과 동일 패턴).
-- 쓰기(upsert)는 서버 액션(refreshModelCatalog)이 service_role(createAdminClient)로 수행 —
-- 클라이언트 직접 쓰기 경로 없음(정책은 admin 열람만 허용, ALL 아님).
-- =============================================================================

CREATE TABLE ai_model_catalog (
  provider        text NOT NULL,
  model_id        text NOT NULL,
  label           text NOT NULL,
  context_length  int,
  capabilities    jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {vision, long_context, reasoning, ...}
  released_at     date,
  is_active       boolean NOT NULL DEFAULT true,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, model_id)
);

CREATE INDEX idx_ai_model_catalog_provider_active
  ON ai_model_catalog (provider, is_active);

ALTER TABLE ai_model_catalog ENABLE ROW LEVEL SECURITY;

-- admin만 열람(SELECT). 쓰기는 서버(service_role)만 — 여기선 정책을 만들지 않아 authenticated 쓰기를 차단.
CREATE POLICY aimc_admin_select ON ai_model_catalog FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM profiles
          WHERE id = (SELECT auth.uid()) AND role = 'admin' AND deleted_at IS NULL)
);

-- 큐레이션 seed — 알려진 모델의 능력/출시일 대략치(서버 refreshModelCatalog가 이후 model_id를
-- 실제 프로바이더 응답으로 upsert하되, capabilities/released_at은 기존값을 보존하고
-- 이 시드 맵으로만 보완한다 — lib/ai-chat/model-catalog.ts 큐레이션 맵과 동일 값).
INSERT INTO ai_model_catalog (provider, model_id, label, context_length, capabilities, released_at) VALUES
  ('gemini', 'gemini-2.0-flash',      'Gemini 2.0 Flash',      1048576, '{"vision":true,"long_context":true,"reasoning":false}'::jsonb, '2025-02-05'),
  ('gemini', 'gemini-1.5-pro',        'Gemini 1.5 Pro',        2097152, '{"vision":true,"long_context":true,"reasoning":true}'::jsonb,  '2024-05-14'),
  ('gemini', 'gemini-1.5-flash',      'Gemini 1.5 Flash',      1048576, '{"vision":true,"long_context":true,"reasoning":false}'::jsonb, '2024-05-14'),
  ('claude', 'claude-opus-4-8',       'Claude Opus 4.8',        200000, '{"vision":true,"long_context":false,"reasoning":true}'::jsonb, '2026-05-01'),
  ('claude', 'claude-sonnet-4-6',     'Claude Sonnet 4.6',       200000, '{"vision":true,"long_context":false,"reasoning":true}'::jsonb, '2026-02-01'),
  ('claude', 'claude-sonnet-4',       'Claude Sonnet 4',         200000, '{"vision":true,"long_context":false,"reasoning":true}'::jsonb, '2025-05-14'),
  ('claude', 'claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet',  200000, '{"vision":true,"long_context":false,"reasoning":false}'::jsonb, '2024-10-22'),
  ('openai', 'gpt-4o',                'GPT-4o',                 128000, '{"vision":true,"long_context":false,"reasoning":false}'::jsonb, '2024-05-13'),
  ('openai', 'gpt-4o-mini',           'GPT-4o mini',            128000, '{"vision":true,"long_context":false,"reasoning":false}'::jsonb, '2024-07-18'),
  ('openai', 'o1',                    'o1',                     200000, '{"vision":true,"long_context":false,"reasoning":true}'::jsonb, '2024-12-05'),
  ('openai', 'o3-mini',               'o3-mini',                200000, '{"vision":false,"long_context":false,"reasoning":true}'::jsonb, '2025-01-31')
ON CONFLICT (provider, model_id) DO NOTHING;
