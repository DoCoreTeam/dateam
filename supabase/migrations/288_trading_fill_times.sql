-- 288 체결 시각을 지어내지 않는다
--
-- `trading_fills.filled_at` 이 NOT NULL 이었는데 **KIS 는 체결 시각을 주지 않는다.**
-- 선물옵션 주문체결내역(inquire-ccnl) 응답 칼럼 33개를 공식 저장소에서 확인했고
-- (`examples_llm/domestic_futureoption/inquire_ccnl/chk_inquire_ccnl.py` 의 COLUMN_MAPPING)
-- 거기 있는 시각은 `ord_tmd`(주문시각) 하나다. 체결시각도 체결순번도 없다.
--
-- NOT NULL 을 채우려면 주문 시각을 넣게 되고, 그러면 체결 지연이 **언제나 0** 이 된다.
-- 0 은 「빨랐다」로 읽히지 「모른다」로 안 읽힌다. 체결 재현(§13.2)이 그 값을 쓴다.
--
-- 그래서 모르는 것은 모른다고 둔다:
--   · `order_at`     주문 시각 = 체결 시각의 **하한**
--   · `first_seen_at` 우리가 처음 본 시각 = **상한** (직전 조회와 이번 조회 사이에 체결됐다)
--   · `filled_at`    KIS 가 주면 그때 채운다. 지금은 null
--
-- 체결 순번도 없다. 1계약이라 부분 체결이 없어(D-13) 한 주문에 체결이 하나이고,
-- `fill_seq` 는 `'0'` 한 값만 쓴다. 2계약 이상을 허용하는 날 여기부터 본다.

ALTER TABLE public.trading_fills ALTER COLUMN filled_at DROP NOT NULL;

ALTER TABLE public.trading_fills
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 수수료. 체결 재현이 비용을 본다 (`fee_smtl`)
ALTER TABLE public.trading_fills
  ADD COLUMN IF NOT EXISTS fee_krw NUMERIC(12,2);

COMMENT ON COLUMN public.trading_fills.filled_at IS
  'KIS 가 체결 시각을 주면 채운다. 주문체결내역에는 없어서 지금은 null';
COMMENT ON COLUMN public.trading_fills.first_seen_at IS
  '우리가 이 체결을 처음 본 시각. 체결 시각의 상한이다 (order_at 이 하한)';
COMMENT ON COLUMN public.trading_fills.fee_krw IS
  '수수료 합계(fee_smtl). 체결 재현이 비용을 본다';

-- 잠금은 안 건드린다. 확인만 한다 — 칼럼을 더하는 판이 RLS 를 조용히 끄는 일이 없게
DO $$
DECLARE r RECORD;
BEGIN
  SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
         (SELECT count(*) FROM pg_policies p
           WHERE p.schemaname = 'public' AND p.tablename = 'trading_fills') AS policies
    INTO r
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'trading_fills';

  IF NOT r.rls OR NOT r.force OR r.policies <> 0 THEN
    RAISE EXCEPTION 'trading_fills 잠금이 풀렸다 (rls=% force=% policies=%)',
      r.rls, r.force, r.policies;
  END IF;
END $$;
