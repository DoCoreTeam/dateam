-- 096_apo_rls_tighten.sql
-- DC-SEC: ai_prompt_outcomes 읽기를 본인 행 + admin 으로 좁힘.
--   094의 is_member() 전체읽기는 동료의 AI 사용 패턴(user_id·시각) 노출 → 영업활동 노출 우려.
-- 멱등.

DROP POLICY IF EXISTS apo_member_read ON ai_prompt_outcomes;
CREATE POLICY apo_own_or_admin_read ON ai_prompt_outcomes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- 롤백: DROP POLICY apo_own_or_admin_read; CREATE POLICY apo_member_read ... is_member();
