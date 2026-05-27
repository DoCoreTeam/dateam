-- ============================================================
-- 022: 일일업무 관계 시스템
-- origin_group · target_date · threads · relations · tags · ai_prompts
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. daily_log_origin_groups — 원본 입력 묶음 anchor
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_log_origin_groups (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_input text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE daily_log_origin_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users: own origin groups" ON daily_log_origin_groups
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_origin_groups_user
  ON daily_log_origin_groups(user_id, created_at DESC);

-- ────────────────────────────────────────────────────────────
-- 2. daily_logs 컬럼 추가 (기존 컬럼 변경 없음)
-- ────────────────────────────────────────────────────────────
ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS target_date       date,
  ADD COLUMN IF NOT EXISTS target_date_set_by text CHECK (target_date_set_by IN ('ai', 'user')),
  ADD COLUMN IF NOT EXISTS origin_group_id   uuid REFERENCES daily_log_origin_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_log_id     uuid REFERENCES daily_logs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_type       text CHECK (source_type IN ('manual', 'ai_split', 'ai_derived', 'thread_derived'));

CREATE INDEX IF NOT EXISTS idx_daily_logs_target_date
  ON daily_logs(user_id, target_date)
  WHERE target_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_daily_logs_origin_group
  ON daily_logs(origin_group_id)
  WHERE origin_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_daily_logs_parent
  ON daily_logs(parent_log_id)
  WHERE parent_log_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 3. daily_log_relations — 지식그래프 엣지 (취약점: same_origin 엣지 제외)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_log_relations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_log_id    uuid NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  to_log_id      uuid NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  relation_type  text NOT NULL CHECK (relation_type IN ('derived_from', 'blocks', 'related', 'mentioned')),
  created_by     text NOT NULL CHECK (created_by IN ('ai', 'user')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- 취약점 방어: 자기 자신 연결 금지, 중복 엣지 금지
  CONSTRAINT no_self_relation CHECK (from_log_id != to_log_id),
  CONSTRAINT unique_relation UNIQUE (from_log_id, to_log_id, relation_type)
);

ALTER TABLE daily_log_relations ENABLE ROW LEVEL SECURITY;

-- RLS: from_log의 user_id 기준 (취약점 7 방어)
CREATE POLICY "users: own relations" ON daily_log_relations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM daily_logs dl
      WHERE dl.id = from_log_id AND dl.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM daily_logs dl
      WHERE dl.id = from_log_id AND dl.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_relations_from ON daily_log_relations(from_log_id);
CREATE INDEX IF NOT EXISTS idx_relations_to   ON daily_log_relations(to_log_id);

-- ────────────────────────────────────────────────────────────
-- 4. daily_log_threads — 스레드(대댓글)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_log_threads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id           uuid NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  author_type      text NOT NULL CHECK (author_type IN ('user', 'ai')),
  content          text NOT NULL,
  -- 취약점 6 방어: 프롬프트 버전 함께 저장
  ai_analysis      jsonb,
  ai_actions_taken jsonb,
  prompt_key       text,
  prompt_version   text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE daily_log_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users: own threads" ON daily_log_threads
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM daily_logs dl
      WHERE dl.id = log_id AND dl.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM daily_logs dl
      WHERE dl.id = log_id AND dl.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_threads_log ON daily_log_threads(log_id, created_at ASC);

-- ────────────────────────────────────────────────────────────
-- 5. daily_log_thread_logs — 스레드에서 생성된 파생 업무 연결
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_log_thread_logs (
  thread_id uuid NOT NULL REFERENCES daily_log_threads(id) ON DELETE CASCADE,
  log_id    uuid NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  PRIMARY KEY (thread_id, log_id)
);

ALTER TABLE daily_log_thread_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users: own thread_logs" ON daily_log_thread_logs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM daily_log_threads t
        JOIN daily_logs dl ON dl.id = t.log_id
      WHERE t.id = thread_id AND dl.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM daily_log_threads t
        JOIN daily_logs dl ON dl.id = t.log_id
      WHERE t.id = thread_id AND dl.user_id = auth.uid()
    )
  );

-- ────────────────────────────────────────────────────────────
-- 6. daily_log_tags — 태그
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_log_tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id     uuid NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  tag_name   text NOT NULL,
  tag_type   text NOT NULL CHECK (tag_type IN ('ai', 'user')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_tag UNIQUE (log_id, tag_name)
);

ALTER TABLE daily_log_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users: own tags" ON daily_log_tags
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM daily_logs dl
      WHERE dl.id = log_id AND dl.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM daily_logs dl
      WHERE dl.id = log_id AND dl.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_tags_log      ON daily_log_tags(log_id);
CREATE INDEX IF NOT EXISTS idx_tags_tag_name ON daily_log_tags(tag_name);

-- ────────────────────────────────────────────────────────────
-- 7. ai_prompts — 프롬프트 관리 (하드코딩 방지)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_prompts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_key    text NOT NULL,
  version       text NOT NULL,
  model_hint    text NOT NULL DEFAULT 'gemini-2.0-flash',
  content       text NOT NULL,
  output_schema jsonb,
  active        boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_prompt_version UNIQUE (prompt_key, version)
);

-- ai_prompts는 org-wide (user별 아님) — 관리자만 쓰기, 전체 읽기
ALTER TABLE ai_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all: read active prompts" ON ai_prompts
  FOR SELECT USING (active = true);

-- active=true인 key는 1개만 허용 (함수로 보장)
CREATE OR REPLACE FUNCTION enforce_single_active_prompt()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.active = true THEN
    UPDATE ai_prompts
    SET active = false
    WHERE prompt_key = NEW.prompt_key
      AND id != NEW.id
      AND active = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_single_active_prompt ON ai_prompts;
CREATE TRIGGER trg_single_active_prompt
  BEFORE INSERT OR UPDATE ON ai_prompts
  FOR EACH ROW EXECUTE FUNCTION enforce_single_active_prompt();

-- ────────────────────────────────────────────────────────────
-- 8. ai_prompts 초기 시드 — analyze-work 프롬프트 (하드코딩에서 이전)
-- ────────────────────────────────────────────────────────────
INSERT INTO ai_prompts (prompt_key, version, model_hint, content, output_schema, active)
VALUES (
  'daily.analyze-work',
  'v1',
  'gemini-2.0-flash',
  $PROMPT$당신은 업무 로그 파서입니다. 사용자의 자유형 텍스트에서 업무 항목을 추출합니다.

## 출력 형식
각 업무 항목을 독립된 JSON 객체로, 한 줄에 하나씩 출력하세요 (NDJSON).
배열 없이, 마크다운 없이, 순수 JSON 줄만 출력하세요.

## 각 항목 구조
{"title":"업무 제목","status":"done|doing|planned|blocker|note","targetDate":"YYYY-MM-DD 또는 null","targetDateCertainty":"exact|inferred|none","scheduledTime":"HH:MM 또는 null","priority":"urgent|high|normal|low","tags":["태그1","태그2"],"accountName":"거래처명 또는 null","contactName":"담당자명 또는 null","confidence":0.0~1.0}

## 추출 규칙
1. 하나의 텍스트에 여러 업무가 있으면 각각 분리
2. 상태 판단:
   - 과거형/완료 표현 → done
   - 현재 진행 중 → doing
   - 미래/예정/할 것 → planned
   - 막힘/문제/이슈 → blocker
   - 단순 메모/참고정보 → note
3. targetDate 파싱 (기준: {TODAY}):
   - "오늘" → {TODAY}, certainty: exact
   - "내일" → {TOMORROW}, certainty: exact
   - "다음주 월요일" → 다음 주 월요일 날짜, certainty: exact
   - "이번주", "월말" 등 모호 → 추론값, certainty: inferred
   - 날짜 없고 status=note → null, certainty: none
   - 날짜 없고 status=planned/doing/blocker → null, certainty: none (UI에서 미설정 표시)
4. tags: 내용에서 핵심 주제 키워드 1-3개 추출 (한국어, # 없이)
5. 우선순위:
   - "긴급", "urgent" → urgent
   - "중요" → high
   - 그 외 → normal
6. 거래처/담당자: 아래 목록과 매칭하되 확신 없으면 null
   거래처 목록: {ACCOUNTS}
   담당자 목록: {CONTACTS}
7. confidence: 항목 추출 확신도 (0.0~1.0)$PROMPT$,
  jsonb_build_object(
    'type', 'object',
    'required', array['title','status','confidence'],
    'properties', jsonb_build_object(
      'title',             jsonb_build_object('type','string'),
      'status',            jsonb_build_object('type','string','enum',array['done','doing','planned','blocker','note']),
      'targetDate',        jsonb_build_object('type',array['string','null']),
      'targetDateCertainty', jsonb_build_object('type','string','enum',array['exact','inferred','none']),
      'scheduledTime',     jsonb_build_object('type',array['string','null']),
      'priority',          jsonb_build_object('type','string','enum',array['urgent','high','normal','low']),
      'tags',              jsonb_build_object('type','array','items',jsonb_build_object('type','string')),
      'accountName',       jsonb_build_object('type',array['string','null']),
      'contactName',       jsonb_build_object('type',array['string','null']),
      'confidence',        jsonb_build_object('type','number','minimum',0,'maximum',1)
    )
  ),
  true
)
ON CONFLICT (prompt_key, version) DO NOTHING;
