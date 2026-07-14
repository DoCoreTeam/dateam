-- =============================================================================
-- 152_ai_chat_projects.sql
-- AI 채팅 세션3: Projects + 프로젝트 지식(pgvector RAG) + 대화-프로젝트 연결
-- RLS: admin+owner default-deny (150 ai_conversations 패턴 동일)
-- pgvector: 042에서 이미 활성화 — 방어적 재선언만 수행
-- =============================================================================

-- 0. pgvector 확장 (042에서 활성화됨 — 멱등 방어)
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. ai_projects — 프로젝트 (owner=admin)
CREATE TABLE ai_projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name         text NOT NULL,
  instructions text,                                   -- 프로젝트 공통 지시(system에 주입)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz                             -- 소프트삭제
);
CREATE INDEX idx_ai_projects_owner
  ON ai_projects (user_id, updated_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE ai_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY aip_owner_admin ON ai_projects FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM profiles
          WHERE id = (SELECT auth.uid()) AND role = 'admin' AND deleted_at IS NULL)
  AND user_id = (SELECT auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM profiles
          WHERE id = (SELECT auth.uid()) AND role = 'admin' AND deleted_at IS NULL)
  AND user_id = (SELECT auth.uid())
);

-- 2. ai_conversations.project_id — 대화-프로젝트 연결
ALTER TABLE ai_conversations
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES ai_projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ai_conversations_project
  ON ai_conversations (project_id) WHERE project_id IS NOT NULL AND deleted_at IS NULL;

-- 3. ai_project_knowledge — 지식 청크 (pgvector 768 — gemini-embedding-001 정합)
CREATE TABLE ai_project_knowledge (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
  content     text NOT NULL,                            -- 청크 본문 (≤2000자 — embedText slice 한도)
  embedding   vector(768),                              -- 임베딩 실패 시 NULL 허용(저장은 막지 않음)
  source      text,                                     -- 원본 식별: 파일명 또는 'manual'
  chunk_index int NOT NULL DEFAULT 0,                   -- 원본 내 청크 순번(복원·삭제 단위)
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_project_knowledge_project
  ON ai_project_knowledge (project_id, source, chunk_index);

-- pgvector 유사도 (cosine) — 042 daily_logs와 동일 파라미터
CREATE INDEX idx_ai_project_knowledge_embedding
  ON ai_project_knowledge USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE ai_project_knowledge ENABLE ROW LEVEL SECURITY;
CREATE POLICY aipk_via_project ON ai_project_knowledge FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM profiles
          WHERE id = (SELECT auth.uid()) AND role = 'admin' AND deleted_at IS NULL)
  AND EXISTS (SELECT 1 FROM ai_projects p
              WHERE p.id = project_id
                AND p.user_id = (SELECT auth.uid())
                AND p.deleted_at IS NULL)
)
WITH CHECK (
  EXISTS (SELECT 1 FROM profiles
          WHERE id = (SELECT auth.uid()) AND role = 'admin' AND deleted_at IS NULL)
  AND EXISTS (SELECT 1 FROM ai_projects p
              WHERE p.id = project_id
                AND p.user_id = (SELECT auth.uid())
                AND p.deleted_at IS NULL)
);

-- 4. top-k 검색 RPC — match_daily_logs(147) 패턴 동일. requester 소유 검증 내장(이중 방어).
CREATE OR REPLACE FUNCTION match_ai_project_knowledge(
  p_project_id    uuid,
  query_embedding vector(768),
  requester_id    uuid,
  match_count     int,
  min_sim         float
)
RETURNS TABLE (id uuid, content text, source text, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT k.id, k.content, k.source, 1 - (k.embedding <=> query_embedding)
  FROM ai_project_knowledge k
  JOIN ai_projects p ON p.id = k.project_id
  WHERE k.project_id = p_project_id
    AND k.embedding IS NOT NULL
    AND p.deleted_at IS NULL
    AND p.user_id = requester_id                        -- owner만 (admin 간 격리 유지)
    AND EXISTS (SELECT 1 FROM profiles pr
                WHERE pr.id = requester_id AND pr.role = 'admin' AND pr.deleted_at IS NULL)
    AND 1 - (k.embedding <=> query_embedding) > min_sim
  ORDER BY k.embedding <=> query_embedding ASC
  LIMIT LEAST(match_count, 20);
$$;

-- 5. 툴 출처 영속화 — web_search citation 복원 재표시용 (§4-3 결정)
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS citations jsonb;  -- [{url,title,snippet?}]
