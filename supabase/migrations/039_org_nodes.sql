-- =============================================================================
-- 039_org_nodes.sql
-- 조직도 통합 노드 테이블 생성 및 기존 데이터 마이그레이션
-- 기존 테이블(org_company, org_departments, org_department_members)은 보존
-- RLS: 인증된 팀원 전체 읽기, admin만 쓰기
-- 롤백: 040_drop_org_legacy.sql에서 별도 처리
-- =============================================================================

-- ── 1. 테이블 생성 ────────────────────────────────────────────────────────────

CREATE TABLE org_nodes (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type          TEXT        NOT NULL CHECK (type IN ('company', 'role', 'department', 'person')),
  parent_id     UUID        REFERENCES org_nodes(id) ON DELETE RESTRICT,
  name          TEXT        NOT NULL,
  subtitle      TEXT,
  display_order INT         NOT NULL DEFAULT 999,
  head_user_id  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  user_id       UUID        REFERENCES profiles(id) ON DELETE CASCADE,
  color         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. 인덱스 ────────────────────────────────────────────────────────────────

-- 트리 탐색: 부모→자식 조회 (가장 빈번한 쿼리)
CREATE INDEX idx_org_nodes_parent_id      ON org_nodes (parent_id);
-- type 필터링 (company/department/person 분리 조회)
CREATE INDEX idx_org_nodes_type           ON org_nodes (type);
-- 부서 내 사람 조회 (parent_id + type 복합)
CREATE INDEX idx_org_nodes_parent_type    ON org_nodes (parent_id, type);
-- 특정 사용자의 노드 조회
CREATE INDEX idx_org_nodes_user_id        ON org_nodes (user_id) WHERE user_id IS NOT NULL;
-- 정렬용
CREATE INDEX idx_org_nodes_display_order  ON org_nodes (parent_id, display_order);

-- ── 3. updated_at 자동 갱신 트리거 ──────────────────────────────────────────

CREATE TRIGGER trg_org_nodes_updated_at
  BEFORE UPDATE ON org_nodes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 4. 데이터 마이그레이션 ──────────────────────────────────────────────────

DO $$
DECLARE
  v_company_id UUID;
  v_company_name TEXT;
  v_company_desc TEXT;
BEGIN

  -- ── 4-1. 회사 노드 삽입 ────────────────────────────────────────────────────
  -- org_company는 id=1 단일 행 보장

  SELECT name, description
    INTO v_company_name, v_company_desc
    FROM org_company
   WHERE id = 1;

  -- 회사 데이터가 없는 환경(빈 DB)도 안전하게 처리
  IF v_company_name IS NULL THEN
    v_company_name := '회사명';
  END IF;

  INSERT INTO org_nodes (type, parent_id, name, subtitle, display_order)
  VALUES ('company', NULL, v_company_name, v_company_desc, 0)
  RETURNING id INTO v_company_id;

  -- ── 4-2. 부서 노드 삽입 (기존 UUID 재사용) ──────────────────────────────
  -- parent_id는 일단 NULL로 삽입 후 별도 UPDATE — FK 순서 문제 방지

  INSERT INTO org_nodes (
    id,
    type,
    parent_id,
    name,
    subtitle,
    display_order,
    created_at,
    updated_at
  )
  SELECT
    d.id,
    'department',
    NULL,                 -- parent_id는 아래 UPDATE에서 처리
    d.name,
    d.description,
    d.display_order,
    d.created_at,
    d.updated_at
  FROM org_departments d;

  -- ── 4-3. 루트 부서(parent_id IS NULL) → 회사 노드 아래 연결 ──────────────

  UPDATE org_nodes
     SET parent_id = v_company_id
   WHERE type = 'department'
     AND id IN (
       SELECT id FROM org_departments WHERE parent_id IS NULL
     );

  -- ── 4-4. 하위 부서(parent_id IS NOT NULL) → 기존 parent_id 복원 ─────────
  -- org_departments.parent_id == org_nodes.id (UUID 재사용으로 직접 매핑 가능)

  UPDATE org_nodes n
     SET parent_id = d.parent_id
    FROM org_departments d
   WHERE n.id = d.id
     AND d.parent_id IS NOT NULL;

  -- ── 4-5. 사람 노드 삽입 (org_department_members × profiles) ──────────────
  -- profiles.deleted_at IS NULL 인 활성 사용자만 마이그레이션
  -- subtitle = COALESCE(position, rank) 우선순위: 직책 > 직급
  -- display_order = ROW_NUMBER() OVER(PARTITION BY department_id ORDER BY profiles.name) * 10

  INSERT INTO org_nodes (
    type,
    parent_id,
    name,
    subtitle,
    display_order,
    user_id,
    created_at,
    updated_at
  )
  SELECT
    'person',
    m.department_id,
    COALESCE(p.name, '(이름 없음)'),
    COALESCE(p.position, p.rank),
    (ROW_NUMBER() OVER (
      PARTITION BY m.department_id
      ORDER BY COALESCE(p.name, '') ASC
    ) * 10)::INT,
    m.user_id,
    now(),
    now()
  FROM org_department_members m
  JOIN profiles p
    ON p.id = m.user_id
   AND p.deleted_at IS NULL;

END $$;

-- ── 5. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE org_nodes ENABLE ROW LEVEL SECURITY;

-- 인증된 사용자 중 프로필이 존재하는(삭제되지 않은) 팀원 전체 읽기
CREATE POLICY "org_nodes_select_authenticated" ON org_nodes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
       WHERE id = auth.uid()
         AND deleted_at IS NULL
    )
  );

-- admin: INSERT
CREATE POLICY "org_nodes_insert_admin" ON org_nodes
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
       WHERE id = auth.uid()
         AND role = 'admin'
         AND deleted_at IS NULL
    )
  );

-- admin: UPDATE
CREATE POLICY "org_nodes_update_admin" ON org_nodes
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
       WHERE id = auth.uid()
         AND role = 'admin'
         AND deleted_at IS NULL
    )
  );

-- admin: DELETE
CREATE POLICY "org_nodes_delete_admin" ON org_nodes
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
       WHERE id = auth.uid()
         AND role = 'admin'
         AND deleted_at IS NULL
    )
  );

-- =============================================================================
-- 롤백 전략 (파괴적 변경 없음 — 기존 테이블 보존)
-- 롤백 시: DROP TABLE org_nodes CASCADE;
-- 기존 데이터는 org_company / org_departments / org_department_members에 원본 유지
-- =============================================================================
