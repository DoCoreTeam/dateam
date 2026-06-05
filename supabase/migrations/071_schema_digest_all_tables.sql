-- 사용자 지시: 스키마 완전 파악 = 일부 생략 없이 모든 테이블 포함.
-- 다이제스트는 구조(컬럼명·타입·제약)만 노출하고 행 데이터(키·비밀번호 값)는 보내지 않으므로 전체 포함해도 안전.
-- 태그('ai:intake')·블랙리스트 제거 → public의 모든 베이스테이블 자동 포함(새 테이블도 자동 편입).
CREATE OR REPLACE FUNCTION public.get_schema_digest()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result text := ''; tbl text; cols text; chk record; fk record; tables text[];
BEGIN
  SELECT array_agg(c.relname ORDER BY c.relname) INTO tables
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r';

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
