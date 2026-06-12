-- 087: competitors 소프트 삭제 — deleted_at 컬럼
-- 경쟁사 관리 탭의 삭제/일괄삭제는 소프트 삭제(복구 가능). 매핑·시장가 데이터 보존.
-- 소프트 삭제 시 deleted_at 기록 + is_active=false 동반 → 기존 is_active=true 조회는 자동 제외.
-- 멱등: IF NOT EXISTS.

ALTER TABLE competitors ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_competitors_active
  ON competitors (is_active)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN competitors.deleted_at IS
  '소프트 삭제 시각. NULL=활성. 경쟁사 관리 탭 삭제/일괄삭제 시 기록(+is_active=false).';
