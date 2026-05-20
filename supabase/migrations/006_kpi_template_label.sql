-- 006_kpi_template_label.sql
-- kpi_entries에 템플릿 참조 컬럼 추가
-- nullable — 기존 자유입력 데이터 영향 없음

ALTER TABLE kpi_entries
  ADD COLUMN IF NOT EXISTS kpi_template_label TEXT;

-- 템플릿 기반 항목 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_kpi_entries_template_label
  ON kpi_entries (kpi_template_label)
  WHERE kpi_template_label IS NOT NULL;
