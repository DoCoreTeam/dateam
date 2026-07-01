-- 140: 약정별(term) 전략 판매가 저장 — gpu_products.strategic_price_krw(단일 컬럼) 한계 해소.
--   왜: strategic_price_krw는 product당 KRW 1개(요금제 컬럼 없음)라 reserved 등 약정 가격을 저장할 자리가 없어
--       검토 확정이 "on_demand만 반영"으로 차단됐다(own-target-import). 이 테이블이 term별 판매가 SSOT.
--   하위호환: on_demand 가격은 gpu_products.strategic_price_krw에도 계속 미러(기존 콕핏/가격표 계산 무변경).
CREATE TABLE IF NOT EXISTS public.gpu_product_term_prices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES public.gpu_products(id) ON DELETE CASCADE,
  term        text NOT NULL,                 -- 표준 term: on_demand | spot | reserved_<N>m | reserved | ...
  price_krw   numeric NOT NULL CHECK (price_krw > 0 AND price_krw <= 100000000000),
  set_by      text,
  set_reason  text,
  set_at      timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, term)
);
CREATE INDEX IF NOT EXISTS idx_gpu_term_prices_product ON public.gpu_product_term_prices(product_id);

ALTER TABLE public.gpu_product_term_prices ENABLE ROW LEVEL SECURITY;

-- 읽기 = 로그인 직원(member+admin). anon·api_user 차단 (092 패턴).
DROP POLICY IF EXISTS gpu_term_prices_member_read ON public.gpu_product_term_prices;
CREATE POLICY gpu_term_prices_member_read ON public.gpu_product_term_prices
  FOR SELECT TO authenticated USING (public.is_member());

-- 쓰기 = service_role 전용(앱 서버가 확정 게이트 뒤에서만 반영).
DROP POLICY IF EXISTS gpu_term_prices_service_write ON public.gpu_product_term_prices;
CREATE POLICY gpu_term_prices_service_write ON public.gpu_product_term_prices
  FOR ALL TO service_role USING (true) WITH CHECK (true);
