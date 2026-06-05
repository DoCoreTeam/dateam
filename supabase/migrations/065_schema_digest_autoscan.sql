-- 축1: get_schema_digest를 하드코딩 화이트리스트 → 코멘트 태그('ai:intake') 자동스캔으로 전환.
-- 새 연계 테이블은 COMMENT 한 줄이면 AI에 자동 노출(확장성). 민감테이블(profiles·api_keys)은 블랙리스트 강제 제외(G1).
-- D5: 담당자(accounts·contacts) 노출 허용.

-- 1) 통합입력 연계 테이블 태깅 (기존 8 + 재고·공급사·담당자)
COMMENT ON TABLE gpu_products IS 'ai:intake — GPU 모델 카탈로그';
COMMENT ON TABLE gpu_specs IS 'ai:intake — 칩 데이터시트';
COMMENT ON TABLE competitors IS 'ai:intake — 경쟁사';
COMMENT ON TABLE competitor_product_mapping IS 'ai:intake — 경쟁사 매핑';
COMMENT ON TABLE market_prices IS 'ai:intake — 시장가';
COMMENT ON TABLE review_items IS 'ai:intake — 통합입력 검토항목';
COMMENT ON TABLE supply_quotes IS 'ai:intake — 공급견적(가격 SSOT)';
COMMENT ON TABLE partner_tiers IS 'ai:intake — 파트너 등급';
COMMENT ON TABLE availability_responses IS 'ai:intake — 공급 가용재고(재고 연계 대상)';
COMMENT ON TABLE direct_pool_stock IS 'ai:intake — 직접 풀 재고';
COMMENT ON TABLE suppliers IS 'ai:intake — 공급사';
COMMENT ON TABLE accounts IS 'ai:intake — 거래처 통합';
COMMENT ON TABLE contacts IS 'ai:intake — 담당자';

-- 2) 자동스캔 버전 (블랙리스트 제외)
CREATE OR REPLACE FUNCTION public.get_schema_digest()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result text := ''; tbl text; cols text; chk record; fk record;
  blacklist text[] := ARRAY['profiles','api_keys'];  -- G1 민감 강제 제외
  tables text[];
BEGIN
  -- 'ai:intake' 코멘트 달린 public 베이스테이블 자동 수집(블랙리스트 제외)
  SELECT array_agg(c.relname ORDER BY c.relname) INTO tables
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r'
    AND obj_description(c.oid,'pg_class') LIKE '%ai:intake%'
    AND c.relname <> ALL(blacklist);

  IF tables IS NULL THEN RETURN ''; END IF;

  FOREACH tbl IN ARRAY tables LOOP
    SELECT string_agg(column_name||' '||data_type||CASE WHEN is_nullable='NO' THEN '*' ELSE '' END, ', ' ORDER BY ordinal_position)
      INTO cols FROM information_schema.columns WHERE table_schema='public' AND table_name=tbl;
    result := result || E'\nTABLE ' || tbl || ' (' || COALESCE(cols,'') || ')';
    FOR chk IN SELECT pg_get_constraintdef(oid) def FROM pg_constraint WHERE contype='c' AND conrelid=('public.'||tbl)::regclass LOOP
      result := result || E'\n  · ' || chk.def;
    END LOOP;
    FOR fk IN SELECT pg_get_constraintdef(oid) def FROM pg_constraint WHERE contype='f' AND conrelid=('public.'||tbl)::regclass LOOP
      result := result || E'\n  → ' || fk.def;
    END LOOP;
  END LOOP;
  RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION public.get_schema_digest() TO anon, authenticated, service_role;
