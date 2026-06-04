-- 056: 공급사 → accounts 통합 (회사=accounts, 담당자=contacts 단일 모델)
-- 전략: ADD → MIGRATE (dual-write). supply_quotes.supplier_id는 보존(가격 SSOT 무회귀),
--       account_id를 병행 추가·백필. 물리 DROP은 UI 전수 검증 후 별도 마이그레이션.

-- 1) accounts 역할 플래그 + 공급사 배지색
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS is_supplier boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_customer boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS color text;

-- 2) suppliers ↔ accounts 브리지
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);

-- 3) 공급사 → accounts 이관 (동명 account 있으면 링크, 없으면 생성)
DO $$
DECLARE s RECORD; aid uuid;
  owner_uid uuid := 'f687c53a-2a1e-4616-9fc4-2c4b52b77d7f';  -- michaelkim (마이그레이션 소유자)
BEGIN
  FOR s IN SELECT * FROM suppliers WHERE account_id IS NULL LOOP
    SELECT id INTO aid FROM accounts WHERE name = s.name LIMIT 1;
    IF aid IS NULL THEN
      INSERT INTO accounts (user_id, name, region, website, description, color, is_supplier, is_customer, source)
      VALUES (owner_uid, s.name, s.country, s.website, s.description, s.color, true, false, 'supplier_migration')
      RETURNING id INTO aid;
    ELSE
      UPDATE accounts SET is_supplier = true, color = COALESCE(color, s.color) WHERE id = aid;
    END IF;
    UPDATE suppliers SET account_id = aid WHERE id = s.id;
  END LOOP;
END $$;

-- 4) supply_quotes.account_id 병행(dual) + 백필
ALTER TABLE supply_quotes ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);
UPDATE supply_quotes q SET account_id = s.account_id
  FROM suppliers s WHERE q.supplier_id = s.id AND q.account_id IS NULL;

-- 5) availability_responses.account_id 병행 + 백필
ALTER TABLE availability_responses ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);
UPDATE availability_responses a SET account_id = s.account_id
  FROM suppliers s WHERE a.supplier_id = s.id AND a.account_id IS NULL;

-- 6) 인덱스
CREATE INDEX IF NOT EXISTS idx_supply_quotes_account ON supply_quotes(account_id);
CREATE INDEX IF NOT EXISTS idx_accounts_is_supplier ON accounts(is_supplier) WHERE is_supplier = true;
