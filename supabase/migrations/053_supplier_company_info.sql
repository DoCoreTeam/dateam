-- 053_supplier_company_info.sql — 공급사 회사정보 컬럼 (ADD-only)
-- 공급사 메뉴에서 국가·웹사이트·소개를 관리(CRUD)하기 위한 필드.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS country text;       -- 국가 (예: 미국, 한국)
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS website text;       -- 공식 홈페이지 URL
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS description text;   -- 회사 소개(웹검색 등으로 채움)
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- 롤백:
--   ALTER TABLE suppliers DROP COLUMN IF EXISTS country, DROP COLUMN IF EXISTS website,
--     DROP COLUMN IF EXISTS description, DROP COLUMN IF EXISTS updated_at;
