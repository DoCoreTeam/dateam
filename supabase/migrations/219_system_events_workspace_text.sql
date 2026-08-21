-- 219_system_events_workspace_text.sql — workspace_id 를 text 로 넓힌다
--
-- 왜: 218 에서 `workspace_id uuid` 로 선언했는데, CRM 워크스페이스 id 는 UUID 가 아니다.
--   실측: `ws_dataalliance`. 그래서 CRM AI 실패를 남기려는 insert 가 매번
--   `invalid input syntax for type uuid` 로 거절당했고, **한 건도 안 남았다.**
--
-- 더 나쁜 것은 그게 조용했다는 점이다 — supabase-js 는 오류를 던지지 않고
-- `{ error }` 로 돌려주는데 코드가 그 값을 안 봤다. 시스템 로그가 조용히 실패한 것이다.
-- 그 코드도 같은 판에서 고쳤다(lib/system-log/record.ts).
--
-- 넓히기만 한다(uuid → text). 좁히는 방향이 아니라 되돌릴 필요가 없다.

ALTER TABLE system_events ALTER COLUMN workspace_id TYPE text USING workspace_id::text;

COMMENT ON COLUMN system_events.workspace_id IS
  'CRM 워크스페이스 id. UUID 가 아니다(예: ws_dataalliance) — text 로 둔다.';
