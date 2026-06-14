-- 092_rls_hardening.sql
-- CRITICAL 보수: RLS 베이스라인 재작성 (전수 감사 0-1/0-2/0-3 + 실 DB pg_policies 확정)
--
-- 닫는 취약(실측):
--   · supply_quotes/suppliers/gpu_products/direct_prices/pricing_settings/gpu_audit_logs
--       SELECT USING(true) TO public  → anon 키(브라우저 번들 공개)로 전 원가·판매가·마진·감사 누출
--   · supply_quotes  auth: update USING(true) TO authenticated → 로그인 누구나 원가 변조
--   · suppliers/supply_quotes  auth: write INSERT TO authenticated → 임의 INSERT
--   · review_items/review_iterations  ALL TO authenticated → 검토큐 직접 RW
--   · market_prices/competitors/competitor_product_mapping/gpu_specs  SELECT TO authenticated USING(true)
--       → api_user(=authenticated 역할)에게도 노출
--
-- 설계 (DECISION-20260615-rls-level):
--   · 읽기 = is_member()(admin+member) — anon·api_user 차단, 로그인 직원만. (pricing 화면은 member도 접근)
--   · 쓰기/변이 = service_role 전용. service_role은 BYPASSRLS이므로 서버 admin client는 무영향.
--     authenticated INSERT/UPDATE 정책은 미사용(서버는 admin client로 씀) → 제거.
--   · bare `TO authenticated USING(true)` 절대 금지(api_user 누출). 반드시 is_member() 술어.
--
-- 함께: gpu_audit_logs action_type CHECK에 quote_selected/quote_deselected 추가(0-9, select 라우트가 사용).
--
-- 멱등성: CREATE OR REPLACE FUNCTION / DROP POLICY IF EXISTS + CREATE / DROP CONSTRAINT IF EXISTS + ADD.
-- 기존 데이터 파괴: 없음(정책/함수/제약만). 적용: scripts/migrate.sh 092_rls_hardening.sql
-- 롤백: 파일 하단 주석 참조.
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 0: 권한 판정 SSOT 함수 (SECURITY DEFINER — profiles RLS 우회로 재귀 차단)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'member')
      AND deleted_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND deleted_at IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.is_member() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_member() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- ============================================================================
-- STEP 1: 정책 재작성 (테이블별 — 개방 read/authenticated write 제거 → is_member read)
--   service_role(BYPASSRLS)이 쓰기를 담당하므로 별도 write 정책 불필요(기존 service 정책은 남겨도 무해).
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  -- 읽기 전용 민감 테이블: 개방 SELECT 제거 + authenticated write 제거 + is_member SELECT 부여
  FOREACH t IN ARRAY ARRAY[
    'supply_quotes','suppliers','gpu_products','direct_prices','pricing_settings','gpu_audit_logs',
    'review_items','review_iterations','market_prices','competitor_product_mapping','competitors','gpu_specs'
  ] LOOP
    IF to_regclass('public.'||t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- 알려진 개방/약한 정책 전부 제거 (pg_policies 실측 기준)
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'all: read '||t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth: write '||t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth: update '||t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth: '||t, t);  -- review_items/iterations ALL authenticated
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_insert', t);

    -- 신규 통일 SELECT: is_member()만 (anon·api_user 차단)
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_member_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_member())',
      t||'_member_read', t
    );
  END LOOP;

  -- 테이블 고유 정책명(루프 패턴에 안 맞는 것) 개별 제거
  EXECUTE 'DROP POLICY IF EXISTS market_prices_select ON public.market_prices';
  EXECUTE 'DROP POLICY IF EXISTS market_prices_insert ON public.market_prices';
  EXECUTE 'DROP POLICY IF EXISTS competitors_select ON public.competitors';
  EXECUTE 'DROP POLICY IF EXISTS comp_map_select ON public.competitor_product_mapping';
  EXECUTE 'DROP POLICY IF EXISTS gpu_specs_select ON public.gpu_specs';

  -- 쓰기 정책 보강: service_role 전용 ALL (BYPASSRLS라 사실상 보조 — 명시화로 의도 박제)
  FOREACH t IN ARRAY ARRAY[
    'supply_quotes','suppliers','gpu_products','direct_prices','pricing_settings','gpu_audit_logs',
    'review_items','review_iterations','market_prices','competitor_product_mapping','competitors','gpu_specs'
  ] LOOP
    IF to_regclass('public.'||t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_service_write', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t||'_service_write', t
    );
  END LOOP;
END $$;

-- ============================================================================
-- STEP 2: gpu_audit_logs action_type CHECK — 091 전체 목록 보존 + quote_selected/deselected 추가
-- ============================================================================
ALTER TABLE gpu_audit_logs DROP CONSTRAINT IF EXISTS gpu_audit_logs_action_type_check;
ALTER TABLE gpu_audit_logs ADD CONSTRAINT gpu_audit_logs_action_type_check
  CHECK (action_type = ANY (ARRAY[
    'quote_registered', 'quote_confirmed', 'lowest_changed', 'expired',
    'direct_set', 'margin_changed', 'rejected',
    'review_created', 'review_finalized', 'review_rejected', 'review_recheck_completed',
    'pool_stock_changed', 'availability_registered', 'inquiry_sent',
    'nonstandard_backfill',
    'quote_supplier_assigned', 'quote_edited', 'quote_deleted',
    'product_created', 'product_updated', 'product_deleted',
    'direct_price_updated', 'direct_price_deleted',
    'market_price_updated', 'market_price_deleted',
    'availability_deleted', 'pool_stock_deleted',
    'strategic_price_set',
    'gcube_price_collected',
    'market_cost_ingested',
    'gcube_reflected',
    -- 092 신규: 견적 채택/해제 (quotes/[id]/select 라우트가 사용 — CHECK 누락 시 audit INSERT 실패)
    'quote_selected', 'quote_deselected'
  ]));

COMMIT;

-- ============================================================================
-- 롤백 (필요 시 별도 실행 — 이 파일에 포함하지 말 것)
-- ============================================================================
-- 주의: 롤백은 "개방 상태로 되돌리는 것"이므로 보안상 권장하지 않음. 정책 단위로 선별 복원할 것.
-- DROP FUNCTION IF EXISTS public.is_member();
-- DROP FUNCTION IF EXISTS public.is_admin();
-- (정책은 092 적용 전 pg_policies 스냅샷을 참고해 수동 복원)
