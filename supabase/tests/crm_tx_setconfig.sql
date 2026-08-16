-- supabase/tests/crm_tx_setconfig.sql
-- withCrmTx 가 의존하는 DB 동작을 실제 DB에서 확인한다 (dacrm T0-05).
-- 단위 테스트는 가짜 클라이언트로 '우리 코드가 무엇을 부르는가'를 검증하고,
-- 이 파일은 '그 호출이 DB에서 실제로 그렇게 동작하는가'를 검증한다. 둘 다 필요하다.
--
-- 실행:
--   PGPASSWORD=... psql -h <pooler> -p 6543 -U postgres.<ref> -d postgres -q -f supabase/tests/crm_tx_setconfig.sql
-- 기대 출력: 5줄 전부 PASS. 아무것도 커밋되지 않는다.

\set ON_ERROR_STOP off

-- [1] 트랜잭션 안에서 set_config 가 걸린다
BEGIN;
SELECT set_config('app.workspace_id', 'ws_alpha', true);
SELECT CASE WHEN current_setting('app.workspace_id', true) = 'ws_alpha'
            THEN 'PASS [1] 트랜잭션 안에서 값이 보인다'
            ELSE 'FAIL [1] 값이 안 잡힌다' END;

-- [2] 같은 트랜잭션에서 audit 를 쓰고, 롤백하면 사라진다
INSERT INTO "crm_audit_log"("id","workspaceId","actorType","action","targetType","targetId")
VALUES ('au_rollback_test','ws_alpha','HUMAN','deal.created','deal','d_test');
SELECT CASE WHEN (SELECT count(*) FROM "crm_audit_log" WHERE id='au_rollback_test') = 1
            THEN 'PASS [2] 트랜잭션 안에서는 audit 이 보인다'
            ELSE 'FAIL [2] insert 가 안 됐다' END;
ROLLBACK;

SELECT CASE WHEN (SELECT count(*) FROM "crm_audit_log" WHERE id='au_rollback_test') = 0
            THEN 'PASS [3] 롤백하면 audit 도 사라진다'
            ELSE 'FAIL [3] 롤백했는데 audit 이 남았다' END;

-- [4] set_config(..., true) 는 트랜잭션 로컬이다 — 트랜잭션 밖으로 새지 않는다
--     새면 커넥션 풀에서 다음 요청이 남의 워크스페이스 값을 물려받는다.
SELECT CASE WHEN coalesce(current_setting('app.workspace_id', true), '') = ''
            THEN 'PASS [4] 트랜잭션 밖으로 새지 않는다'
            ELSE 'FAIL [4] 값이 세션에 남았다 = 풀 재사용 시 교차 오염' END;

-- [5] 세 번째 인자를 false 로 두면 실제로 샌다 (왜 true 여야 하는지의 근거)
BEGIN;
SELECT set_config('app.workspace_id', 'ws_leak', false);
COMMIT;
SELECT CASE WHEN current_setting('app.workspace_id', true) = 'ws_leak'
            THEN 'PASS [5] false 는 세션에 남는다 — 그래서 코드는 true 를 쓴다'
            ELSE 'FAIL [5] 전제가 바뀌었다. tx.ts 주석을 다시 확인할 것' END;

-- 뒷정리: [5] 가 세션에 남긴 값을 지운다
SELECT set_config('app.workspace_id', '', false);
