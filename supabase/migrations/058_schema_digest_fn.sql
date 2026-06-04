-- R1: DB 전체 스키마 자가인지 — 런타임에 가격 도메인 테이블의 컬럼·타입·CHECK(enum)·FK를
-- information_schema/pg_constraint에서 자동 파생해 텍스트 다이제스트로 반환.
-- AI가 메모리를 잃어도 이 함수 호출만으로 현재 DB 구조를 정확히 인지 → 확장성(새 컬럼·enum 자동 반영).
-- 손수정 스키마 계약서 의존 제거: 값이 코드가 아니라 라이브 DB에서 나옴.

CREATE OR REPLACE FUNCTION public.get_schema_digest()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result text := '';
  tbl text;
  cols text;
  chk record;
  fk record;
  tables text[] := ARRAY[
    'gpu_products','gpu_specs','competitors','competitor_product_mapping',
    'market_prices','review_items','supply_quotes','partner_tiers'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- 테이블 존재 확인
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=tbl) THEN
      CONTINUE;
    END IF;

    SELECT string_agg(column_name || ' ' || data_type ||
             CASE WHEN is_nullable='NO' THEN '*' ELSE '' END, ', ' ORDER BY ordinal_position)
      INTO cols
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name=tbl;

    result := result || E'\nTABLE ' || tbl || ' (' || COALESCE(cols,'') || ')';

    -- CHECK 제약(enum 허용값 포함)
    FOR chk IN
      SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE contype='c' AND conrelid = ('public.'||tbl)::regclass
    LOOP
      result := result || E'\n  · ' || chk.def;
    END LOOP;

    -- FK 관계
    FOR fk IN
      SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE contype='f' AND conrelid = ('public.'||tbl)::regclass
    LOOP
      result := result || E'\n  → ' || fk.def;
    END LOOP;
  END LOOP;

  RETURN result;
END $$;

-- 익명/인증 역할이 호출 가능하도록(서버는 service_role 사용)
GRANT EXECUTE ON FUNCTION public.get_schema_digest() TO anon, authenticated, service_role;
