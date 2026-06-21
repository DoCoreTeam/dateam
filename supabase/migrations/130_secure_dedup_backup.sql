-- =============================================================================
-- 130_secure_dedup_backup.sql
-- 보안 보완(DC-SEC H1): 129가 만든 백업테이블 gpu_products_dedup_backup_20260622는
-- CREATE TABLE AS 로 RLS 미활성·기본권한 노출 상태(가격/원가 스냅샷 = 영업기밀).
-- → RLS 활성 + anon/authenticated 권한 회수(service_role만 접근). 검증 후 7일 내 DROP 권장.
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='gpu_products_dedup_backup_20260622') THEN
    EXECUTE 'ALTER TABLE gpu_products_dedup_backup_20260622 ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON gpu_products_dedup_backup_20260622 FROM anon, authenticated';
  END IF;
END $$;
