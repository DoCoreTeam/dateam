-- 축6 H1(DC-REV): ai_prompts 본문은 추출 스키마·영업로직 포함 → 일반 authenticated 노출 차단.
-- 서버 hot path(추출·거버넌스·admin API)는 전부 service_role(RLS 우회)이라 무중단 확인됨.
DROP POLICY IF EXISTS "all: read active prompts" ON public.ai_prompts;
-- 관리자만 직접 SELECT 허용(혹시 모를 클라 읽기), 그 외엔 API(service_role) 경유
DROP POLICY IF EXISTS "admin read prompts" ON public.ai_prompts;
CREATE POLICY "admin read prompts" ON public.ai_prompts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
