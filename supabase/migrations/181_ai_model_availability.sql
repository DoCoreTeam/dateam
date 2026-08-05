-- 모델 선택 전에 현재 키 기준 가용 상태와 점검 시각을 안내한다.
ALTER TABLE ai_model_catalog
  ADD COLUMN IF NOT EXISTS availability text NOT NULL DEFAULT 'unknown'
    CHECK (availability IN ('available', 'limited', 'unavailable', 'unknown')),
  ADD COLUMN IF NOT EXISTS availability_reason text,
  ADD COLUMN IF NOT EXISTS availability_checked_at timestamptz;

COMMENT ON COLUMN ai_model_catalog.availability IS
  '현재 API 키 기준 실사용 프로브 결과. available/limited/unavailable/unknown';
