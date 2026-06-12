-- 090_market_rls.sql
-- 보안 보강(DC-SEC #3): market_prices · competitor_product_mapping 의 RLS 명시화.
--   이 두 테이블은 추적 마이그레이션에 CREATE/RLS가 없어(외부 raw SQL 생성) RLS 적용 여부 불명.
--   anon 노출을 차단하기 위해 RLS를 켜고, 기존 동작(인증 임직원 읽기 / service_role 쓰기)을 보존하는
--   정책을 멱등적으로 부여한다. (CLAUDE.md "RLS 필수")
--
-- 안전성: 멱등(존재 시에만 처리 + drop policy if exists). RLS enable는 이미 켜져 있으면 no-op.
--   SELECT 정책을 함께 만들므로 enable로 인한 default-deny로 기존 읽기가 깨지지 않는다.
-- 적용: 배포 시 scripts/migrate.sh 090_market_rls.sql (Ralph 루프는 커밋까지만 — 자동 적용 안 함).

do $$
begin
  if to_regclass('public.market_prices') is not null then
    execute 'alter table public.market_prices enable row level security';
    execute 'drop policy if exists market_prices_read on public.market_prices';
    -- 인증 사용자(임직원) 읽기 — 기존 GPU 모듈 포스처 유지(anon 차단)
    execute 'create policy market_prices_read on public.market_prices for select to authenticated using (true)';
    execute 'drop policy if exists market_prices_write on public.market_prices';
    -- 쓰기는 service_role 전용(서버 라우트는 admin client 사용)
    execute 'create policy market_prices_write on public.market_prices for all to service_role using (true) with check (true)';
  end if;

  if to_regclass('public.competitor_product_mapping') is not null then
    execute 'alter table public.competitor_product_mapping enable row level security';
    execute 'drop policy if exists cpm_read on public.competitor_product_mapping';
    execute 'create policy cpm_read on public.competitor_product_mapping for select to authenticated using (true)';
    execute 'drop policy if exists cpm_write on public.competitor_product_mapping';
    execute 'create policy cpm_write on public.competitor_product_mapping for all to service_role using (true) with check (true)';
  end if;
end $$;
