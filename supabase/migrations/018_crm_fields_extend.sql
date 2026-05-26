-- CRM 갭 보완: accounts/contacts/deals 신규 필드 추가
-- 기획 문서: docs/2026-05-26-lead/gcube_리드관리_구조설계_v1.0.html 기준

-- accounts: 거래처유형, GPU수요강도 추가
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS account_type TEXT,
  ADD COLUMN IF NOT EXISTS gpu_demand_intensity TEXT;

-- contacts: 역할 추가
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS role TEXT;

-- deals: 리드유형, 제품, 적합도, HW포함, 신규딜여부, 예상날짜 추가
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS lead_type TEXT,
  ADD COLUMN IF NOT EXISTS product TEXT,
  ADD COLUMN IF NOT EXISTS fit_score INTEGER,
  ADD COLUMN IF NOT EXISTS hw_included BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_new_deal BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS expected_date TEXT;

-- account_type 값 예시: '최종고객', '파트너', '리셀러', '경쟁사'
-- gpu_demand_intensity: 'High', 'Medium', 'Low'
-- lead_type: '직접영업', '파트너', '인바운드'
-- fit_score on deal: deals 테이블에 별도 적합도 (account fit_score와 다른 맥락)
