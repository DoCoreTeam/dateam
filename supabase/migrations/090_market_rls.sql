-- 090_market_rls.sql — SUPERSEDED BY 092_rls_hardening.sql
--
-- 원래 090은 market_prices / competitor_product_mapping 에 `to authenticated using(true)` SELECT 정책을
-- 부여했으나, 이는 api_user(=authenticated 역할)에게도 노출되는 약점이 있어 092가 is_member() 기준으로
-- 재작성하며 흡수했다. 090을 092 이후 적용하면 정책이 다시 개방되므로 본 파일은 의도적으로 no-op 으로
-- 중립화한다. (092가 두 테이블의 RLS를 모두 소유)
--
-- 미적용 상태에서 중립화 — 적용 순서와 무관하게 안전.

SELECT 1;
