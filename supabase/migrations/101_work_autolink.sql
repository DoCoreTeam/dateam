-- 101: 업무 AI 완전 자동 연관 연결 — 기반(임베딩·관계메타·엔티티링크·학습·RPC·프롬프트)
--  설계: docs/2026-06-15-work-ai-autolink-plan/. 완전 자동이되 가역(연결행만)·투명(근거/신뢰도)·자가보정.
--  멱등(IF NOT EXISTS). 쓰기는 service_role, 읽기는 owner/admin. 기존 수동경로 무수정.

-- 0) 엔티티명 퍼지매칭용 확장
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1) 비즈니스 엔티티 임베딩 컬럼(+인덱스) — daily_logs엔 이미 있음(042)
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS embedding vector(768);
ALTER TABLE deals    ADD COLUMN IF NOT EXISTS embedding vector(768);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS embedding vector(768);
CREATE INDEX IF NOT EXISTS idx_accounts_embedding ON accounts USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_deals_embedding    ON deals    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_contacts_embedding ON contacts USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 2) daily_log_relations(업무↔업무)에 자동연결 메타 추가 (created_by='ai' 이미 있음)
ALTER TABLE daily_log_relations ADD COLUMN IF NOT EXISTS confidence numeric;        -- 0~1
ALTER TABLE daily_log_relations ADD COLUMN IF NOT EXISTS reason text;               -- 근거 1문장
ALTER TABLE daily_log_relations ADD COLUMN IF NOT EXISTS weak boolean NOT NULL DEFAULT false;  -- 추천(점선)=true, 확정=false

-- 3) 업무→엔티티(거래처/딜/연락처) 자동 링크 (단일FK 대신 다후보·신뢰도·가역)
CREATE TABLE IF NOT EXISTS work_entity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id uuid NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('account','deal','contact')),
  entity_id uuid NOT NULL,
  confidence numeric,
  reason text,
  weak boolean NOT NULL DEFAULT false,
  created_by text NOT NULL DEFAULT 'ai' CHECK (created_by IN ('ai','user')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (log_id, kind, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_wel_log ON work_entity_links(log_id);
CREATE INDEX IF NOT EXISTS idx_wel_entity ON work_entity_links(kind, entity_id);

-- 4) 학습 신호(연결 수락/해제) — Level1 임계보정·Level2 정정메모리 (append-only)
CREATE TABLE IF NOT EXISTS autolink_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id uuid REFERENCES daily_logs(id) ON DELETE SET NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('log','account','deal','contact')),
  target_id uuid,
  action text NOT NULL CHECK (action IN ('unlink','confirm','keep','auto_created')),  -- unlink=오답, confirm/keep=정답
  band text CHECK (band IN ('high','mid','low')),
  confidence numeric,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_autolink_feedback_created ON autolink_feedback(created_at desc);

-- 5) 학습된 별칭 사전(Level2) — "삼성"→삼성전자(주) 같은 표기 매핑 누적
CREATE TABLE IF NOT EXISTS autolink_alias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('account','deal','contact')),
  entity_id uuid NOT NULL,
  weight int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (raw_name, kind, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_autolink_alias_name ON autolink_alias USING gin (raw_name gin_trgm_ops);

-- 6) 학습된 임계값(Level1) — 단일행 jsonb (밴드·종류별 τ + 표본수)
CREATE TABLE IF NOT EXISTS autolink_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  thresholds jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO autolink_config (id, thresholds) VALUES (1, '{
  "log":     {"tau_auto":0.82, "tau_suggest":0.62, "sample":0},
  "account": {"tau_auto":0.88, "tau_suggest":0.66, "sample":0},
  "deal":    {"tau_auto":0.88, "tau_suggest":0.66, "sample":0},
  "contact": {"tau_auto":0.88, "tau_suggest":0.66, "sample":0}
}'::jsonb) ON CONFLICT (id) DO NOTHING;

-- 7) RLS — 읽기는 owner/admin, 쓰기는 service_role(정책 미부여=거부). default-deny.
ALTER TABLE work_entity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE autolink_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE autolink_alias    ENABLE ROW LEVEL SECURITY;
ALTER TABLE autolink_config   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wel_select ON work_entity_links;
CREATE POLICY wel_select ON work_entity_links FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM daily_logs dl WHERE dl.id = log_id AND (
    dl.user_id = (SELECT auth.uid())
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin' AND p.deleted_at IS NULL)
  )));

DROP POLICY IF EXISTS alias_select ON autolink_alias;
CREATE POLICY alias_select ON autolink_alias FOR SELECT TO authenticated USING (true);  -- 별칭사전은 조직공용(엔티티명만, PII 아님)
DROP POLICY IF EXISTS cfg_select ON autolink_config;
CREATE POLICY cfg_select ON autolink_config FOR SELECT TO authenticated USING (true);
-- autolink_feedback: 본인 생성분만 조회(나머지는 service_role 집계)
DROP POLICY IF EXISTS afb_select ON autolink_feedback;
CREATE POLICY afb_select ON autolink_feedback FOR SELECT TO authenticated
  USING (created_by = (SELECT auth.email()) OR created_by = (SELECT auth.uid())::text);

-- 8) pgvector top-K RPC (코사인 유사도). 서버(service_role)가 호출. 1-(거리)=유사도.
CREATE OR REPLACE FUNCTION match_daily_logs(query_embedding vector(768), exclude_id uuid, match_count int, min_sim float)
RETURNS TABLE (id uuid, content text, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT id, content, 1 - (embedding <=> query_embedding)
  FROM daily_logs
  WHERE embedding IS NOT NULL AND id <> exclude_id AND 1 - (embedding <=> query_embedding) > min_sim
  ORDER BY embedding <=> query_embedding ASC
  LIMIT least(match_count, 50);
$$;

CREATE OR REPLACE FUNCTION match_accounts(query_embedding vector(768), match_count int, min_sim float)
RETURNS TABLE (id uuid, name text, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT id, name, 1 - (embedding <=> query_embedding)
  FROM accounts WHERE embedding IS NOT NULL AND 1 - (embedding <=> query_embedding) > min_sim
  ORDER BY embedding <=> query_embedding ASC LIMIT least(match_count, 30);
$$;

CREATE OR REPLACE FUNCTION match_deals(query_embedding vector(768), match_count int, min_sim float)
RETURNS TABLE (id uuid, title text, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT id, COALESCE(title, '') , 1 - (embedding <=> query_embedding)
  FROM deals WHERE embedding IS NOT NULL AND 1 - (embedding <=> query_embedding) > min_sim
  ORDER BY embedding <=> query_embedding ASC LIMIT least(match_count, 30);
$$;

CREATE OR REPLACE FUNCTION match_contacts(query_embedding vector(768), match_count int, min_sim float)
RETURNS TABLE (id uuid, name text, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT id, name, 1 - (embedding <=> query_embedding)
  FROM contacts WHERE embedding IS NOT NULL AND 1 - (embedding <=> query_embedding) > min_sim
  ORDER BY embedding <=> query_embedding ASC LIMIT least(match_count, 30);
$$;

-- 9) AI 프롬프트 seed (거버넌스 경유 운영) — 엔티티 추출 + 관계 판정
INSERT INTO ai_prompts (prompt_key, version, model_hint, content, output_schema, active)
VALUES
('work.autolink-extract','v1','gemini-2.0-flash',
 E'당신은 업무 텍스트에서 고유명사를 추출하는 전문가입니다. 주어진 업무 내용에서 회사/거래처명, 인물(담당자)명, 딜/제품/프로젝트명을 추출해 JSON으로만 반환하세요.\n출력: {"companies":["..."],"people":["..."],"deals":["..."]}\n없으면 빈 배열. 추측 금지, 본문에 등장한 표현만.',
 '{"type":"object"}', true),
('work.autolink-judge','v1','gemini-2.0-flash',
 E'당신은 업무 간/업무-데이터 간 연관성을 판정하는 전문가입니다. [기준 업무]와 각 [후보]가 실제로 관련 있는지, 어떤 관계인지, 신뢰도(0~1)와 근거를 판정하세요.\n관계유형: related(일반연관)|derived_from(파생/후속)|about_account(이 거래처 건)|about_deal(이 딜 건)|mentions(인물 언급).\n출력(JSON만): {"results":[{"candidate_id":"...","related":true,"relation":"related","confidence":0.0,"reason":"한 문장 근거"}]}\n확실하지 않으면 related=false. 근거는 반드시 기준/후보 텍스트에 근거. 환각 금지.',
 '{"type":"object","required":["results"]}', true)
ON CONFLICT (prompt_key, version) DO UPDATE
  SET content=EXCLUDED.content, model_hint=EXCLUDED.model_hint, output_schema=EXCLUDED.output_schema, active=true;
