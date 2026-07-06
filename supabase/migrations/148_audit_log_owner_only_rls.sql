-- 148_audit_log_owner_only_rls.sql
-- 보안 하드닝(DC-SEC HIGH): audit_log SELECT를 소유자 전용으로 좁힘.
-- 왜: 기존 `owner_id OR actor_id`는 향후 app.actor_id 배선(대리작업) 시,
--   행위자(예: 관리자·부서장)가 자신이 손댄 **타인 엔티티의 before/after 전체 스냅샷**(본문 포함)을
--   영구 열람하게 되는 과열람 구멍. actor가 owner와 같은 현재는 기능손실 0이며, 미래 구멍을 선제 봉합.
-- 행위자가 "자기 행위 이력"을 봐야 하는 요구는 추후 본문 제외 메타 뷰로 별도 분리(결정지점).

DROP POLICY IF EXISTS audit_log_select ON audit_log;
CREATE POLICY audit_log_select ON audit_log
  FOR SELECT USING (owner_id = auth.uid());
