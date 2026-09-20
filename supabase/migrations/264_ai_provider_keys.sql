-- 264_ai_provider_keys.sql — 공급자마다 키를 여러 개
--
-- 왜: 지금은 공급자 하나에 키 하나다 (org_content META 의 문자열 칸 다섯).
--   무료 티어 한도는 프로젝트마다 모델마다 걸리므로(실측 2026-08-27, quotaValue 20),
--   키 하나가 마르면 그 공급자를 쓰는 기능이 전부 그날 멈춘다.
--   키를 여러 개 두면 마른 키를 건너뛰고 이어서 부를 수 있다.
--
-- 왜 META 안의 배열이 아니라 표인가
--   상태를 **써야** 하기 때문이다. 언제까지 쉬어야 하는지, 마지막으로 언제 썼는지,
--   몇 번 연속으로 실패했는지를 호출이 날 때마다 기록한다.
--   META 는 jsonb 한 줄이라 병렬로 도는 작업(CI 수집, RFP 분석, 회의 정리)이
--   동시에 고치면 서로를 덮는다. 이 저장소는 같은 원인으로 파일을 잃은 적이 있다.
--
-- 기존 META 칸은 **지우지 않는다**
--   마흔 자리가 아직 `meta.gemini_api_key` 를 직접 읽는다. 여기서 칸을 빼면
--   그 마흔 자리가 전부 「키가 없다」로 조용히 죽는다.
--   이 판은 표를 만들고 지금 값을 첫 줄로 옮겨 심기만 한다.
--   META 는 읽는 자리가 다 옮겨진 뒤 별도 판에서 뗀다.
--
-- 보안 (LOOP.md 7절 S1)
--   RLS 를 같은 판에서 켠다. 정책은 하나도 만들지 않는다 = 익명과 로그인 사용자 전면 차단.
--   service_role 은 rolbypassrls 라 앱 경로(createAdminClient)는 그대로 돈다.
--   GRANT 와 RLS 는 다른 벽이다. Supabase 기본 권한이 anon 에게 붙으므로 따로 회수한다.
--   이 표에는 API 키 원문이 들어간다. 원장과 화면에는 가림값과 label 만 나간다.
--
-- 되돌리기:
--   drop table if exists ai_provider_keys;
--   (META 칸은 그대로 남아 있으므로 표를 지워도 지금 동작으로 돌아온다)

CREATE TABLE IF NOT EXISTS ai_provider_keys (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- lib/ai/provider-catalog.ts 의 AiProviderId. 그 명세가 SSOT 이므로 여기서 enum 으로 굳히지 않는다
  provider              text NOT NULL,
  -- 사람이 붙인 이름. 원장과 화면에 남는 값이고 키 원문은 어느 쪽에도 안 나간다
  label                 text NOT NULL,
  api_key               text NOT NULL,
  -- 낮을수록 먼저. 앞의 키부터 소진한다 (고르게 나누면 전부 같은 날 같이 마른다)
  priority              int NOT NULL DEFAULT 0,
  -- 사람이 끈 것. 기계가 끄는 것은 cooldown_until 과 disabled_reason 이 맡는다
  is_active             boolean NOT NULL DEFAULT true,
  -- 한도에 걸려 쉬는 중. 이 시각 전에는 후보에서 빠진다
  cooldown_until        timestamptz,
  -- 'quota' 는 기다리면 풀리고 'auth' 는 사람이 고쳐야 풀린다. 둘을 같은 말로 하지 않는다
  disabled_reason       text CHECK (disabled_reason IN ('quota', 'auth')),
  last_used_at          timestamptz,
  last_ok_at            timestamptz,
  -- 사용자에게 보일 만큼만. 공급자 원문은 키 조각이 섞여 오므로 그대로 싣지 않는다
  last_error            text,
  consecutive_failures  int NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- 같은 키를 두 번 넣으면 폴백이 같은 벽을 두 번 친다
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_provider_keys_value
  ON ai_provider_keys (provider, api_key);
-- 이름이 겹치면 원장의 key_ref 가 어느 키를 가리키는지 말할 수 없다
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_provider_keys_label
  ON ai_provider_keys (provider, label);
-- 고르는 질의가 매 호출마다 돈다
CREATE INDEX IF NOT EXISTS idx_ai_provider_keys_pick
  ON ai_provider_keys (provider, priority, id);

-- ── 잠금 ────────────────────────────────────────────────────
-- 정책 0개. 서비스롤 말고는 아무도 못 읽고 못 쓴다
ALTER TABLE public.ai_provider_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_provider_keys FORCE ROW LEVEL SECURITY;

-- RLS 위에 한 겹 더. 표 권한과 행 정책은 다른 벽이다
REVOKE ALL ON public.ai_provider_keys FROM PUBLIC;
REVOKE ALL ON public.ai_provider_keys FROM anon;
REVOKE ALL ON public.ai_provider_keys FROM authenticated;
GRANT  ALL ON public.ai_provider_keys TO service_role;

-- ── 지금 값 옮겨 심기 ───────────────────────────────────────
-- META 에 값이 있는 공급자만. 빈 칸은 줄을 만들지 않는다 (없는 키를 있는 것처럼 보이면 안 된다)
INSERT INTO ai_provider_keys (provider, label, api_key, priority)
SELECT m.provider, '기본', m.api_key, 0
FROM (
  SELECT p.provider,
         nullif(btrim(oc.value ->> p.meta_key), '') AS api_key
  FROM org_content oc
  CROSS JOIN (VALUES
    ('gemini', 'gemini_api_key'),
    ('claude', 'claude_api_key'),
    ('openai', 'openai_api_key'),
    -- Groq 키는 「음성 인식」 카드에서 들어와 이름이 stt_api_key 다. 이름을 바꾸지 않는다
    ('groq',   'stt_api_key'),
    ('grok',   'xai_api_key')
  ) AS p(provider, meta_key)
  WHERE oc.key = 'META'
) m
WHERE m.api_key IS NOT NULL
ON CONFLICT DO NOTHING;

COMMENT ON TABLE ai_provider_keys IS
  '공급자별 API 키 여러 개와 그 상태. 원문 키가 들어 있어 service_role 밖으로 열지 않는다';
COMMENT ON COLUMN ai_provider_keys.label IS
  '사람이 붙인 이름. 원장 key_ref 와 화면에 나가는 값이고 키 원문은 나가지 않는다';
COMMENT ON COLUMN ai_provider_keys.priority IS
  '낮을수록 먼저 쓴다. 고르게 나누지 않고 앞부터 소진해야 마른 키와 남은 키가 눈에 보인다';
COMMENT ON COLUMN ai_provider_keys.cooldown_until IS
  '한도에 걸려 쉬는 중. 이 시각 전에는 후보에서 빠진다';
COMMENT ON COLUMN ai_provider_keys.disabled_reason IS
  'quota 는 기다리면 풀리고 auth 는 사람이 고쳐야 풀린다';
