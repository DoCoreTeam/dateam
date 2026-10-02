-- 302 · 딜 원가가 **통화와 수량과 단가를 지닌다**
--
-- 왜: 공급사에서 받은 외화 견적서를 원가로 넣으면 금액 한 칸만 남았다.
-- 그 결과 $1,080.00 의 센트값 108000 이 원화로 앉아 화면에 「108,000원」으로 떴고,
-- 참값(1,346.40 환율로 1,454,112원)의 **13.46분의 1** 이 되었다.
-- 값이 열 배 넘게 작아졌는데 그럴듯한 금액으로 보이는 것이 이 사고의 성질이다 —
-- 원가가 작아지면 마진은 커지고, 그 딜은 「남는 장사」로 보인 채 값이 정해진다.
-- (실측 2026-10-02: 그 딜의 마진율이 94.6% 로 떠 있었고 참값은 27.3% 였다)
--
-- 통화 칸(currency)은 229 가 이미 만들어 두었다. **아무도 쓰지 않았을 뿐이다.**
-- 그래서 여기서 통화를 또 만들지 않는다 — 통화가 두 칸이면 어느 쪽이 맞는지 아무도 모른다.
--
-- 환율 세 칸은 crm_quote 의 237 과 **같은 이름·같은 뜻**이다. 만든 날의 환율을 박아 두고
-- 그 뒤로는 그 값만 쓴다. 조회할 때마다 환산하면 어제 본 마진이 오늘 달라진다.
-- 자리수는 prisma 가 적어 둔 것(Decimal(18,6))에 맞춘다 — 237 은 자리수를 안 적어
-- 표와 schema.prisma 가 서로 다른 말을 하고 있다. 새 칸에서 그것을 따라 하지 않는다.
--
-- 줄 다섯 칸(kind·quantity·unit·unitPriceMinor·remark)은 crm_quote_line 과
-- **같은 이름**이다. 이름이 다르면 원가를 견적 줄로 옮길 때 매핑 함수가 또 생기고,
-- 그 매핑이 칸을 떨어뜨리는 것이 바로 이 사고였다(quote-cost-intake.ts 가 여덟 칸만 넘겼다).
--
-- 규격 칸은 만들지 않는다. crm_quote_line 에도 없다 — 규격은 descriptionMd 의 첫 줄이고
-- 그 아래가 구성이다(lib/crm/domain/quote-spec.ts 의 joinSpec·splitSpec 이 그 약속의 SSOT).
-- crm_deal_cost 에도 descriptionMd 가 이미 있으므로 같은 약속을 그대로 쓴다.
-- 여기에만 spec 칸을 만들면 규격이 두 자리에 살고, 원가를 견적 줄로 옮길 때
-- 어느 쪽을 믿을지 아무도 모른다 — 통화를 두 칸 만들지 않는 것과 같은 이유다.

ALTER TABLE crm_deal_cost
  -- ── 환율 (crm_quote 237 과 같은 규약) ──────────────────────
  ADD COLUMN IF NOT EXISTS "fxRate"   NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS "fxDate"   DATE,
  ADD COLUMN IF NOT EXISTS "fxSource" TEXT,
  -- ── 줄 (crm_quote_line 과 같은 이름) ──────────────────────
  ADD COLUMN IF NOT EXISTS kind            "CrmQuoteLineKind" NOT NULL DEFAULT 'QUANTITY',
  ADD COLUMN IF NOT EXISTS quantity        NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS unit            TEXT,
  ADD COLUMN IF NOT EXISTS "unitPriceMinor" BIGINT,
  ADD COLUMN IF NOT EXISTS remark          TEXT;

COMMENT ON COLUMN crm_deal_cost."fxRate" IS
  '1 통화당 원. currency 가 KRW 면 NULL — 환산할 것이 없다. 못 받았을 때도 NULL 이고 1 로 눕히지 않는다';
COMMENT ON COLUMN crm_deal_cost."fxDate" IS
  '그 환율의 고시일. 화면이 「9-14 고시」라고 밝혀야 사람이 숫자를 믿거나 의심할 수 있다';
COMMENT ON COLUMN crm_deal_cost."fxSource" IS
  '어디서 온 환율인가(koreaexim). 근거를 남긴다';
COMMENT ON COLUMN crm_deal_cost.kind IS
  '줄 종류 여섯. crm_quote_line.kind 와 같은 enum — 원가를 견적 줄로 1대1 로 옮기기 위해서다';
COMMENT ON COLUMN crm_deal_cost.quantity IS
  '수량. 종류마다 뜻이 다르다(USAGE 면 사용시간, EFFORT 면 M/M). NULL 이면 문서에서 못 읽은 것이다';
COMMENT ON COLUMN crm_deal_cost."unitPriceMinor" IS
  '단가. currency 기준 minor. **못 읽었으면 NULL 이다** — 0 으로 눕히면 0원짜리 줄이 조용히 들어간다';
COMMENT ON COLUMN crm_deal_cost.remark IS
  '비고. 이 견적에서 그 줄이 무슨 구실인가. 규격(descriptionMd 첫 줄)과 다르다';

-- 환율은 양수이거나 없다. 0 이나 음수가 들어오면 환산이 조용히 0원을 만든다
ALTER TABLE crm_deal_cost DROP CONSTRAINT IF EXISTS chk_deal_cost_fx_rate_positive;
ALTER TABLE crm_deal_cost
  ADD CONSTRAINT chk_deal_cost_fx_rate_positive
  CHECK ("fxRate" IS NULL OR "fxRate" > 0);

-- 수량과 단가도 음수가 아니다. 할인은 금액을 음수로 만드는 것이 아니라 별도 칸이 할 일이다
ALTER TABLE crm_deal_cost DROP CONSTRAINT IF EXISTS chk_deal_cost_qty_nonneg;
ALTER TABLE crm_deal_cost
  ADD CONSTRAINT chk_deal_cost_qty_nonneg
  CHECK (quantity IS NULL OR quantity >= 0);

ALTER TABLE crm_deal_cost DROP CONSTRAINT IF EXISTS chk_deal_cost_unit_price_nonneg;
ALTER TABLE crm_deal_cost
  ADD CONSTRAINT chk_deal_cost_unit_price_nonneg
  CHECK ("unitPriceMinor" IS NULL OR "unitPriceMinor" >= 0);

-- ── RLS ────────────────────────────────────────────────────────
-- 새 표가 아니므로 정책을 새로 만들지 않는다. 229 가 켜 둔 것이 그대로인지만 확인한다.
-- 사본(CREATE TABLE AS)을 뜨지 않았으므로 물려받지 못한 잠금도 없다.
ALTER TABLE crm_deal_cost ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_deal_cost FROM anon, authenticated;
