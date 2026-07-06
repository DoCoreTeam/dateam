-- 146_audit_backbone.sql
-- 완벽 이력 백본 — DB 트리거 기반 서버측 감사(유실0 수렴 · 사용자 저장 절대 비차단).
-- 기획: docs/2026-07-06-audit-completeness-and-restore/00-plan.md (v2)
--
-- 원칙(사용자 확정): 저장을 막지 않는다. 유실은 다계층 fallback으로 0에 수렴.
--   fn_audit는 EXCEPTION-guard로 원 write를 절대 롤백하지 않는다. 1차 audit_log 실패 시
--   2차 audit_fallback 마커(초경량)에 남겨 reconciler가 사후 보강. 2차마저 실패는 총 DB 장애뿐.
-- 빈틈0: 앱 어느 경로로 바뀌든 트리거가 잡음(우회경로 원천차단). before/after 전체행 자동 스냅샷 → 복구 재료.

-- ── 1. 감사 테이블(append-only) ──
CREATE TABLE IF NOT EXISTS audit_log (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name   TEXT NOT NULL,
  entity_id    UUID,
  op           TEXT NOT NULL CHECK (op IN ('insert','update','delete','restore')),
  actor_id     UUID,
  owner_id     UUID,
  before_json  JSONB,
  after_json   JSONB,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_owner  ON audit_log (owner_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (table_name, entity_id, occurred_at DESC);

-- 2차 초경량 마커(1차 실패 시). pk만 → 거의 실패 불가.
CREATE TABLE IF NOT EXISTS audit_fallback (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name  TEXT NOT NULL,
  entity_id   UUID,
  op          TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reconciled  BOOLEAN NOT NULL DEFAULT false
);

-- ── 2. RLS ── (SELECT: 소유자 또는 행위자 본인만. INSERT는 SECURITY DEFINER 트리거로만 → 정책 불필요)
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_fallback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_log_select ON audit_log;
CREATE POLICY audit_log_select ON audit_log
  FOR SELECT USING (owner_id = auth.uid() OR actor_id = auth.uid());
-- audit_fallback은 서비스롤/관리자만(사용자 노출 불필요) → SELECT 정책 없음(default deny).

-- ── 3. 공용 트리거 함수 (never-block, 2계층 fallback) ──
CREATE OR REPLACE FUNCTION fn_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp   -- 스키마 스쿼팅 방지
AS $$
DECLARE
  v_actor  UUID;
  v_owner  UUID;
  v_before JSONB;
  v_after  JSONB;
  v_entity UUID;
  v_row    JSONB;
BEGIN
  -- 전체를 EXCEPTION으로 감쌈: fn_audit의 어떤 오류(캐스트·락·직렬화 등)도 원 write를 절대 롤백하지 않는다.
  BEGIN
    BEGIN
      v_actor := nullif(current_setting('app.actor_id', true), '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_actor := NULL;
    END;
    v_actor := coalesce(v_actor, auth.uid());

    IF TG_OP = 'DELETE' THEN
      v_before := to_jsonb(OLD); v_after := NULL; v_row := v_before;
    ELSIF TG_OP = 'UPDATE' THEN
      v_before := to_jsonb(OLD); v_after := to_jsonb(NEW); v_row := v_after;
    ELSE
      v_before := NULL; v_after := to_jsonb(NEW); v_row := v_after;
    END IF;
    -- id/user_id는 uuid가 아닐 수 있으므로 정규식 검증 후에만 캐스트(캐스트 예외 방지).
    v_entity := CASE WHEN v_row->>'id' ~ '^[0-9a-f-]{36}$' THEN (v_row->>'id')::uuid ELSE NULL END;
    v_owner  := CASE WHEN v_row->>'user_id' ~ '^[0-9a-f-]{36}$' THEN (v_row->>'user_id')::uuid ELSE NULL END;
    v_owner := coalesce(v_owner, v_actor);
    v_actor := coalesce(v_actor, v_owner);

    INSERT INTO audit_log(table_name, entity_id, op, actor_id, owner_id, before_json, after_json)
    VALUES (TG_TABLE_NAME, v_entity, lower(TG_OP), v_actor, v_owner, v_before, v_after);
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO audit_fallback(table_name, op) VALUES (TG_TABLE_NAME, lower(TG_OP));
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- 원 write는 절대 막지 않음(차단0). 잔여 유실 = 총 DB 장애(원 write도 실패).
    END;
  END;
  RETURN NULL;  -- AFTER 트리거
END;
$$;

-- ── 4. 트리거 부착 (존재 확인된 도메인 테이블) ──
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['daily_logs','weekly_reports','projects','calendar_events','daily_log_threads','work_entity_links']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fn_audit()', t);
  END LOOP;
END $$;

-- ── 5. daily_logs 소프트삭제 컬럼(복구 전제) ──
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_daily_logs_not_deleted ON daily_logs (user_id) WHERE deleted_at IS NULL;

-- ── 6. 법적 파기 예외경로(PII) — 관리자만, 파기 자체를 audit에 남김 ──
-- append-only 원칙의 유일 예외: 개인정보 파기 요청. 서비스롤/관리자 경로에서만 호출.
CREATE OR REPLACE FUNCTION fn_purge_audit(p_table TEXT, p_entity UUID, p_reason TEXT DEFAULT 'legal_erasure')
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_count INTEGER;
BEGIN
  -- 관리자 확인(auth.uid()가 admin일 때만). 서비스롤(auth.uid() null)은 호출측에서 통제.
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'fn_purge_audit: admin only';
  END IF;
  DELETE FROM audit_log WHERE table_name = p_table AND entity_id = p_entity;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  -- 파기 사실 자체를 감사에 남김(무결성)
  INSERT INTO audit_log(table_name, entity_id, op, actor_id, owner_id, after_json)
  VALUES (p_table, p_entity, 'delete', auth.uid(), auth.uid(),
          jsonb_build_object('_purged', true, 'reason', p_reason, 'purged_rows', v_count));
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION fn_purge_audit(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_purge_audit(text, uuid, text) TO service_role;
