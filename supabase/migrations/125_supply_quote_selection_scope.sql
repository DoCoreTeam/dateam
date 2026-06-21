-- =============================================================================
-- 125_supply_quote_selection_scope.sql
-- 공급가 지정 범위(v0.7.228): supply_quotes.selection_scope 추가.
--   'config' = 이 구성만 지정(기존 동작) | 'model' = 모델 4개 구성 전부(파생 전파 상속)
--   is_selected=true일 때만 의미. 기본 'config'(기존 지정의 동작 불변 — 비파괴).
-- 사용자 요구: 파생 구성 어디서든 [공급가 지정] → "4개 전부 / 이 구성만" 모달 선택.
-- =============================================================================
ALTER TABLE supply_quotes
  ADD COLUMN IF NOT EXISTS selection_scope text NOT NULL DEFAULT 'config'
  CHECK (selection_scope IN ('config', 'model'));
