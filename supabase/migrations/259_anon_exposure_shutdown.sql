-- 259_anon_exposure_shutdown.sql — 익명 노출 차단
--
-- 배경: Supabase 보안 경보(2026-09-13) 가 지목한 것은 RLS 꺼진 표였지만,
-- 실측해 보니 **경보가 못 본 구멍이 둘 더 있었다.**
--   ① RLS 꺼진 표 8개 — 익명 읽기뿐 아니라 쓰기·삭제까지 됐다 (INSERT 201 / DELETE 204 실증)
--   ② SECURITY DEFINER 뷰 6개 — 바탕 표는 RLS 로 막혀 0행인데 뷰로는 다 읽혔다
--   ③ TO public USING(true) 정책 7개 — 정책이 있으니 경보는 조용했다
--
-- 무해 근거 (고치기 전에 확인한 것)
--   - service_role 은 rolbypassrls=true → RLS 를 켜도 서비스롤 경로는 그대로 돈다
--   - ai_llm_calls / ai_external_transfers 는 lib/ai/ledger.ts 가 createAdminClient 로만 씀
--   - 나머지 6개 표는 앱 참조 0건
--   - 뷰는 anon 만 회수한다, authenticated·service_role 은 건드리지 않으므로 화면이 안 깨진다
--   - 브라우저가 직접 질의하는 표는 system_settings 하나뿐(app/develop/page.tsx:323, brand_name)

-- ─────────────────────────────────────────────────────────────
-- ① RLS 꺼진 표 8개 — 켠다
-- ─────────────────────────────────────────────────────────────

-- 원장 둘: 서비스롤로만 쓰고 화면 소비가 없다 → 정책 0개(= 익명·로그인 사용자 전면 차단)
ALTER TABLE public.ai_llm_calls            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_external_transfers   ENABLE ROW LEVEL SECURITY;

-- 백업 표 다섯: 앱 참조 0건 → 정책 0개. 지우는 것은 되돌릴 수 없으므로 여기서는 가리기만 한다.
ALTER TABLE public.lead_intakes_dup_backup_20260817 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ci_reclassify_backup_20260827    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ci_topic_rules_backup_20260827   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_ci_channels_20260811        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_ci_contents_ch_20260811     ENABLE ROW LEVEL SECURITY;

-- 신규 CRM 표: 형제(crm_quote·crm_deal)와 같은 작업공간 격리 정책을 붙인다
ALTER TABLE public.crm_quote_section ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_quote_section FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_quote_section_tenant ON public.crm_quote_section;
CREATE POLICY crm_quote_section_tenant ON public.crm_quote_section
  FOR ALL TO public
  USING ("workspaceId" = current_setting('app.workspace_id', true));

-- ─────────────────────────────────────────────────────────────
-- ② SECURITY DEFINER 뷰 — 익명 읽기만 회수
--
-- security_invoker 로 바꾸지 않는 이유: 이 뷰들을 SECURITY DEFINER 함수 셋
-- (replace_weekly_report, replace_weekly_report_items, snapshot_weekly_report) 이 부른다.
-- 의미를 바꾸면 그쪽이 조용히 달라진다. 구멍은 «누가 읽을 수 있나» 쪽이므로 거기만 닫는다.
-- ─────────────────────────────────────────────────────────────
REVOKE SELECT ON public.v_lowest_quotes               FROM anon;
REVOKE SELECT ON public.v_gpu_master                  FROM anon;
REVOKE SELECT ON public.v_user_departments            FROM anon;
REVOKE SELECT ON public.v_user_managed_nodes          FROM anon;
REVOKE SELECT ON public.v_fresh_availability          FROM anon;
REVOKE SELECT ON public.v_product_availability_summary FROM anon;
REVOKE SELECT ON public.v_member_employment_status    FROM anon;

-- ─────────────────────────────────────────────────────────────
-- ③ TO public USING(true) 정책 — 로그인한 사람으로 좁힌다
-- ─────────────────────────────────────────────────────────────

-- 환율: 익명이 쓸 수 있었다(ALL). 읽기는 로그인, 쓰기는 서비스롤.
DROP POLICY IF EXISTS crm_exchange_rate_shared ON public.crm_exchange_rate;
CREATE POLICY crm_exchange_rate_read  ON public.crm_exchange_rate FOR SELECT TO authenticated USING (true);
CREATE POLICY crm_exchange_rate_write ON public.crm_exchange_rate FOR ALL    TO service_role USING (true) WITH CHECK (true);

-- 시스템 사건 처방: 익명이 쓸 수 있었다(ALL).
DROP POLICY IF EXISTS service_write_remedies ON public.system_event_remedies;
CREATE POLICY remedies_read  ON public.system_event_remedies FOR SELECT TO authenticated USING (true);
CREATE POLICY remedies_write ON public.system_event_remedies FOR ALL    TO service_role USING (true) WITH CHECK (true);

-- 시스템 설정: /develop 이 로그인 전에 brand_name 을 읽는다 → 브랜딩 키만 열어 둔다.
-- (weekly_report_hierarchy_enabled 같은 내부 깃발이 함께 새던 것을 닫는다)
DROP POLICY IF EXISTS system_settings_public_read ON public.system_settings;
CREATE POLICY system_settings_branding_read ON public.system_settings
  FOR SELECT TO public
  USING (key IN ('brand_name', 'brand_tagline', 'logo_path', 'active_theme'));
CREATE POLICY system_settings_member_read ON public.system_settings
  FOR SELECT TO authenticated USING (true);

-- 공급사 등급·경쟁사 가격·환율: 원가와 경쟁 정보다. 익명에게 줄 이유가 없다.
DROP POLICY IF EXISTS "all: read supplier_model_tier" ON public.supplier_model_tier;
CREATE POLICY supplier_model_tier_read ON public.supplier_model_tier FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "all: read gcube_price_checks" ON public.gcube_price_checks;
CREATE POLICY gcube_price_checks_read ON public.gcube_price_checks FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "all: read fx_rates" ON public.fx_rates;
CREATE POLICY fx_rates_read ON public.fx_rates FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "all: read fx_rates_multi" ON public.fx_rates_multi;
CREATE POLICY fx_rates_multi_read ON public.fx_rates_multi FOR SELECT TO authenticated USING (true);

-- ─────────────────────────────────────────────────────────────
-- ④ SECURITY DEFINER 함수 search_path 고정
--
-- 고정하지 않으면 호출자가 search_path 를 바꿔치기해 같은 이름의 가짜 표를 물릴 수 있다.
-- 이 넷은 권한 판정 함수라 특히 위험하다(rfp_is_admin·rfp_can_write).
-- ─────────────────────────────────────────────────────────────
ALTER FUNCTION public.rfp_is_admin(uuid)            SET search_path = public, pg_temp;
ALTER FUNCTION public.rfp_can_write(uuid)           SET search_path = public, pg_temp;
ALTER FUNCTION public.rfp_my_orgs()                 SET search_path = public, pg_temp;
ALTER FUNCTION public.rfp_enroll_new_profile()      SET search_path = public, pg_temp;

-- ─────────────────────────────────────────────────────────────
-- ⑤ anon 롤의 쓰기 권한 회수 — RLS 가 유일한 방벽이던 상태를 끝낸다
--
-- 회수 전: anon 이 271개 표에 INSERT·UPDATE·DELETE·TRUNCATE 권한을 들고 있었다.
-- RLS 정책 하나만 빠뜨려도 곧바로 쓰기가 뚫린다는 뜻이다(실제로 8개가 그랬다).
-- SELECT 는 남긴다 — /develop 의 브랜딩 조회가 그 경로를 쓴다.
-- ─────────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon;
