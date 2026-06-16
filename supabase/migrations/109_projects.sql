-- 109: 프로젝트 그룹핑 — 경량 projects 엔티티 + autolink 후보 확장
--  목적: 업무를 묶는 사용자 소유 "프로젝트" 개념을 신설하고, autolink(work_entity_links)가
--        'project'를 후보 kind로 다룰 수 있게 한다. 임베딩 매칭으로 자동 제안(match_projects).
--  설계: 거래처/딜과 달리 프로젝트는 *사용자 소유*(user_id) → RLS는 owner 기준 default-deny.
--        소프트삭제(deleted_at)는 앱 레이어에서 처리(여기선 컬럼만 제공).
--  멱등(IF NOT EXISTS). 기존 테이블/정책 무수정. CONCURRENTLY 미사용(마이그레이션 트랜잭션 안전).
--  참고 스타일: 042(vector768·ivfflat), 101(work_entity_links·match RPC), 075(owner RLS).

-- 0) 퍼지 매칭/벡터 확장 (이미 활성화돼 있으면 무영향)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

-- 1) projects 테이블 (경량) — 사용자 소유, 임베딩 보유, 소프트삭제 가능
CREATE TABLE IF NOT EXISTS projects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  user_id    uuid NOT NULL REFERENCES profiles(id),   -- 소유자
  embedding  vector(768),                              -- autolink 임베딩 매칭용 (nullable)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz                               -- soft delete (앱에서 set)
);

-- 1-1) 인덱스
-- 소유자 스코프 조회 (목록/매칭 1차 필터). 활성 행만(소프트삭제 제외) 부분 인덱스.
CREATE INDEX IF NOT EXISTS idx_projects_user
  ON projects (user_id) WHERE deleted_at IS NULL;
-- 이름 검색·퍼지 매칭 (trigram GIN)
CREATE INDEX IF NOT EXISTS idx_projects_name_trgm
  ON projects USING gin (name gin_trgm_ops);
-- 임베딩 코사인 유사도 (ivfflat) — match_projects 가속
CREATE INDEX IF NOT EXISTS idx_projects_embedding
  ON projects USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 1-2) updated_at 자동 갱신 트리거 (공통 헬퍼 set_updated_at() 재사용 — 001에 정의됨)
DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 1-3) RLS — 소유자 기준 default-deny (정책 없는 동작=거부).
--      select/insert/update/delete 모두 user_id = auth.uid(). 소프트삭제는 앱이 deleted_at update로 처리.
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projects_select ON projects;
CREATE POLICY projects_select ON projects FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS projects_insert ON projects;
CREATE POLICY projects_insert ON projects FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS projects_update ON projects;
CREATE POLICY projects_update ON projects FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS projects_delete ON projects;
CREATE POLICY projects_delete ON projects FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- 2) work_entity_links.kind 에 'project' 허용
--    101 정의: kind text NOT NULL CHECK (kind IN ('account','deal','contact')) → CHECK 제약이므로 ALTER 필요.
--    제약명은 Postgres 자동생성(work_entity_links_kind_check). DROP 후 'project' 포함해 재생성(멱등).
ALTER TABLE work_entity_links DROP CONSTRAINT IF EXISTS work_entity_links_kind_check;
ALTER TABLE work_entity_links
  ADD CONSTRAINT work_entity_links_kind_check
  CHECK (kind IN ('account','deal','contact','project'));

-- 3) match_projects RPC — autolink 프로젝트 제안용.
--    시그니처: match_accounts/match_deals(101/102) 패턴 + 소유자 스코프(H1 교훈: 교차노출 차단).
--    (query_embedding, requester_id, match_count, min_sim) → 본인 소유 활성 projects top-N {id,name,similarity}.
--    1 - (거리) = 코사인 유사도. SECURITY DEFINER + search_path 고정(검색경로 변조 방지).
DROP FUNCTION IF EXISTS match_projects(vector, uuid, int, float);
CREATE OR REPLACE FUNCTION match_projects(
  query_embedding vector(768),
  requester_id uuid,
  match_count int,
  min_sim float
)
RETURNS TABLE (id uuid, name text, similarity float)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, 1 - (p.embedding <=> query_embedding)
  FROM projects p
  WHERE p.embedding IS NOT NULL
    AND p.deleted_at IS NULL
    AND p.user_id = requester_id
    AND 1 - (p.embedding <=> query_embedding) > min_sim
  ORDER BY p.embedding <=> query_embedding ASC
  LIMIT least(match_count, 30);
$$;

-- 권한: 기존 match RPC와 동일하게 서버(service_role) + 로그인 사용자(authenticated) 호출 허용.
GRANT EXECUTE ON FUNCTION match_projects(vector, uuid, int, float) TO service_role, authenticated;
