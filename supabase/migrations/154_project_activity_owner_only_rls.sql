-- 149_project_activity_owner_only_rls.sql
-- 보안 하드닝(DC-SEC HIGH): project_activity SELECT를 소유자 전용으로 좁힘.
-- 왜: 기존 `user_id = auth.uid() OR actor_id = auth.uid()`(마이그142)는 향후 대리작업(actor≠owner,
--   예: 관리자가 타인 프로젝트를 대신 수정) 배선 시, 행위자가 자신이 손댄 **타인 프로젝트의
--   before/after 전체 스냅샷**(name·budget 등 본문 포함)을 영구 열람하게 되는 과열람 구멍.
--   actor가 owner와 같은 현재는 기능손실 0이며, 미래 구멍을 선제 봉합(마이그148 audit_log와 동일 패턴).
-- 행위자 "자기 행위 이력" 요구는 추후 본문 제외 메타 뷰로 별도 분리(결정지점).

DROP POLICY IF EXISTS project_activity_select ON project_activity;
CREATE POLICY project_activity_select ON project_activity
  FOR SELECT USING (user_id = auth.uid());
