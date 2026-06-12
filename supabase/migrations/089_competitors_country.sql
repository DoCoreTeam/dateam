-- 089: competitors.country 추가 — 경쟁사 관리 표에서 국기(countryFlag) 표시용
-- region('global'/'korea'/'domestic')은 분류 카테고리라 국가코드가 아님 → 별도 country 컬럼.
-- 백필: region이 한국계('korea'/'domestic')면 'KR'. 'global'은 NULL(관리자가 개별 지정).
-- 멱등: IF NOT EXISTS.

ALTER TABLE competitors ADD COLUMN IF NOT EXISTS country text NULL;

UPDATE competitors SET country = 'KR'
WHERE country IS NULL AND region IN ('korea', 'domestic');

COMMENT ON COLUMN competitors.country IS
  '경쟁사 본사 국가코드(예: KR, US, JP). 국기 표시용. region(분류)과 별개.';
