-- ============================================================
-- 200_crm_rls_probe_role.sql — RLS 검증용 롤 (T0-10, dacrm v0.5.9)
--
-- 왜 필요한가
--   T0-03 에서 확인한 사실: 이 DB 의 postgres 롤은 rolbypassrls = true 다.
--   BYPASSRLS 는 FORCE ROW LEVEL SECURITY 보다 우선하므로, postgres 로 접속해서는
--   "정책이 실제로 거르는지"를 확인할 방법이 없다. 정책을 잘못 써도 테스트가 통과한다.
--   TASKS T0-10 의 완료 기준("set_config 만으로 격리되는지")은 그 상태로는 성립하지 않는다.
--
-- 무엇을 만드는가
--   crm_rls_probe — NOLOGIN · NOBYPASSRLS 롤.
--   NOLOGIN 인 이유: 새 접속 경로(=새 비밀번호, 새 시크릿)를 만들지 않기 위해서다.
--   기존 postgres 세션에서 `SET LOCAL ROLE crm_rls_probe` 로 잠깐 갈아입고 확인한 뒤
--   트랜잭션이 끝나면 원래대로 돌아온다. 시크릿이 늘지 않는다.
--
-- 안전성
--   - 로그인할 수 없으므로 외부에서 이 롤로 붙을 수 없다.
--   - 권한은 crm_ 테이블로만 한정한다. 호스트 205개 테이블에는 어떤 권한도 주지 않는다.
--   - 순수 추가다. 기존 롤·권한·테이블을 변경하지 않는다.
--   - 되돌리기: REVOKE 후 DROP ROLE crm_rls_probe.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_rls_probe') THEN
    CREATE ROLE crm_rls_probe NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO crm_rls_probe;

-- crm_ 테이블에만 DML 권한. 호스트 테이블은 이름조차 등장하지 않는다.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename LIKE 'crm\_%'
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO crm_rls_probe', t);
  END LOOP;
END $$;

-- postgres 가 SET ROLE 로 갈아입을 수 있게 멤버십을 준다(검증 세션 전용).
GRANT crm_rls_probe TO postgres;
