-- 리드 인테이크 대량 임포트 지원
-- ParsedLeadData의 신규 필드(gpu_demand_intensity 등)는 JSONB에 저장되므로 스키마 변경 불필요
-- lead_intakes.source 체크 제약 확인 및 xlsx_bulk 허용

-- source 컬럼에 체크 제약이 있을 경우 제거 후 재생성
DO $$
BEGIN
  -- 기존 CHECK 제약 제거 (있는 경우)
  ALTER TABLE lead_intakes DROP CONSTRAINT IF EXISTS lead_intakes_source_check;

  -- 새 CHECK 제약 추가 (xlsx_bulk 포함)
  ALTER TABLE lead_intakes ADD CONSTRAINT lead_intakes_source_check
    CHECK (source IN ('prompt', 'file', 'card_scan', 'voice', 'xlsx_bulk'));
END $$;

-- 대량 임포트 조회 최적화 인덱스
CREATE INDEX IF NOT EXISTS idx_lead_intakes_user_source
  ON lead_intakes(user_id, source);

-- crm_registered 상태 지원 확인
DO $$
BEGIN
  ALTER TABLE lead_intakes DROP CONSTRAINT IF EXISTS lead_intakes_status_check;
  ALTER TABLE lead_intakes ADD CONSTRAINT lead_intakes_status_check
    CHECK (status IN ('pending', 'completed', 'failed', 'crm_registered'));
END $$;
