-- 305: 견적 품목과 원가 줄에 「얼마 동안」 축을 더한다
--
-- 견적 한 줄이 곱할 수 있는 축이 **하나뿐**이었다 — 단가 × 수량. 그런데 임대 견적은
-- 축이 둘이다. **몇 대를** 곱하기 **얼마 동안**. 칸이 하나면 둘 중 하나는 반드시 버려진다.
--
-- 실측 2026-10-06, 견적 DA-2026-1006-03: 원본이 「17대 × 936,000원/월 × 2개월」로 적은 것을
-- 수량 17 · 단위 「개월」로 읽어 **2개월이 통째로 사라졌다**. 원본 총 금액 34,980,000원이
-- 17,503,200원으로 저장됐고 차액은 17,476,800원이다. 「2개월」은 규격 맨 밑에
-- 「금액 2개월」이라는 글로만 남아 셈에 안 닿았다.
--
-- 같은 자리를 전수로 세면(품목 164줄): 단위가 「개월」인 줄 9개와 「Hours」인 줄 3개가
-- **기간에 수량 칸을 내주고 대수를 못 적고 있고**, 기간이 설명 글로만 남은 줄이 9개다.
-- 공급 기간 날짜 칸(303 에서 만든 startDate·endDate)은 **금액을 안 바꾸기 때문에**
-- 164줄 중 **0줄**이 쓴다 — 금액을 안 바꾸는 칸은 아무도 안 채운다.
--
-- **왜 날짜로 안 하고 수와 단위로 하나**: 날짜는 「언제」를 말하고 기간은 「얼마나」를 말한다.
-- 사람은 「2개월」은 아는데 「10/7~12/6」은 모를 때가 많다. 날짜가 있으면 거기서 세어 채워 준다.
--
-- **기존 행은 한 줄도 안 바뀐다.** 두 칸이 NULL 이면 배수는 1 이고, 그것이 지금까지의 셈이다.
-- 백필하지 않는다 — 단위가 「개월」인 9줄은 한 축으로 **맞는** 줄이라 손대면 금액이 달라지고,
-- 이미 나간 견적서와 화면이 다른 말을 하게 된다.
--
-- 보안 (LOOP.md 7절 세 질문)
--   ① 새 데이터를 저장하나 — 예. 다만 **새 표가 아니라 있는 표 둘에 칼럼**이다.
--      crm_quote_line 과 crm_deal_cost 는 둘 다 RLS 가 이미 켜져 있고(실측 2026-10-06:
--      relrowsecurity=t), 새 칼럼은 그 정책 아래로 그대로 들어간다 — 따로 켤 것이 없다.
--      crm_deal_cost 는 정책이 0개라 **익명·일반 역할은 아무것도 못 한다**(서비스롤만 지난다).
--      CREATE TABLE AS 사본을 만들지 않으므로 원본 잠금이 떨어져 나갈 자리가 없다.
--   ② 새 창구를 여나 — 아니오. 라우트·정책·GRANT 를 하나도 건드리지 않는다.
--   ③ 밖에서 온 값을 다루나 — 예. 그래서 **DB 가 직접 막는다**(아래 CHECK 셋).
--      화면과 서버가 이미 거르지만 그 둘을 안 지나는 길(관리자 도구·다른 세션의 스크립트)이
--      생기면 음수 기간이 들어와 금액이 음수가 된다.
--   새 칼럼에 비밀값 없음 — 수 하나와 단위 문자열 하나다.

-- ── 견적 품목 ──────────────────────────────────────────────────────────────
ALTER TABLE crm_quote_line
  ADD COLUMN IF NOT EXISTS "durationValue" numeric(12,3),
  ADD COLUMN IF NOT EXISTS "durationUnit"  text;

COMMENT ON COLUMN crm_quote_line."durationValue" IS
  '얼마 동안인가 — 수량과 함께 단가에 곱해진다(17대 × 2개월). NULL 이면 배수 1 이고 지금까지의 셈 그대로';
COMMENT ON COLUMN crm_quote_line."durationUnit" IS
  '기간 단위 — MONTH·DAY·HOUR·YEAR 넷. 「주」는 월 환산이 안 떨어져 「약」이 늘 붙으므로 두지 않는다';

/*
  **CHECK 셋을 건다.**

  ① 0 과 음수를 막는다. 0 이 들어오면 그 줄의 금액이 통째로 0 이 되고, 음수면 합계가 줄어든다.
     「기간 없음」은 0 이 아니라 NULL 이다 — 둘은 다른 사실이다.
  ② 단위는 네 가지뿐이다. 자유 문자열로 두면 「2개월」·「2 month」·「월」이 섞여 들어오고
     환산하는 쪽이 그때마다 다르게 읽는다.
  ③ **둘은 한 벌이다.** 값만 있고 단위가 없으면 2 가 2개월인지 2시간인지 알 수 없고,
     단위만 있고 값이 없으면 곱할 것이 없다. 반쪽짜리를 저장할 수 있게 두면
     읽는 쪽이 저마다 다른 기본값으로 메운다.
*/
ALTER TABLE crm_quote_line DROP CONSTRAINT IF EXISTS chk_quote_line_duration_value;
ALTER TABLE crm_quote_line
  ADD CONSTRAINT chk_quote_line_duration_value
  CHECK ("durationValue" IS NULL OR "durationValue" > 0);

ALTER TABLE crm_quote_line DROP CONSTRAINT IF EXISTS chk_quote_line_duration_unit;
ALTER TABLE crm_quote_line
  ADD CONSTRAINT chk_quote_line_duration_unit
  CHECK ("durationUnit" IS NULL OR "durationUnit" IN ('MONTH', 'DAY', 'HOUR', 'YEAR'));

ALTER TABLE crm_quote_line DROP CONSTRAINT IF EXISTS chk_quote_line_duration_pair;
ALTER TABLE crm_quote_line
  ADD CONSTRAINT chk_quote_line_duration_pair
  CHECK (("durationValue" IS NULL) = ("durationUnit" IS NULL));

-- ── 원가 줄 ────────────────────────────────────────────────────────────────
/*
  **원가에도 같은 두 칸을 같은 이름으로 둔다.**

  crm_deal_cost 는 견적 줄과 칸 이름을 일부러 맞춰 둔 표다(302 의 주석: 「이름이 다르면
  원가를 견적 줄로 옮길 때 매핑이 또 생기고, 그 매핑이 칸을 떨어뜨린다」).

  견적만 두 축이 되면 17대 × 2개월짜리 매출에 **한 달치 원가**가 붙어 마진율이 두 배로
  거짓이 된다 — 외화 견적이 센트값을 원화로 앉혀 마진율 94.6% 를 찍었던 것과 같은 모양이다.
*/
ALTER TABLE crm_deal_cost
  ADD COLUMN IF NOT EXISTS "durationValue" numeric(12,3),
  ADD COLUMN IF NOT EXISTS "durationUnit"  text;

COMMENT ON COLUMN crm_deal_cost."durationValue" IS
  '얼마 동안인가 — 견적 줄의 같은 이름 칸과 같은 뜻. 매출이 2개월이면 원가도 2개월이어야 마진이 참이다';
COMMENT ON COLUMN crm_deal_cost."durationUnit" IS
  '기간 단위 — MONTH·DAY·HOUR·YEAR 넷. crm_quote_line 과 같은 목록이다';

ALTER TABLE crm_deal_cost DROP CONSTRAINT IF EXISTS chk_deal_cost_duration_value;
ALTER TABLE crm_deal_cost
  ADD CONSTRAINT chk_deal_cost_duration_value
  CHECK ("durationValue" IS NULL OR "durationValue" > 0);

ALTER TABLE crm_deal_cost DROP CONSTRAINT IF EXISTS chk_deal_cost_duration_unit;
ALTER TABLE crm_deal_cost
  ADD CONSTRAINT chk_deal_cost_duration_unit
  CHECK ("durationUnit" IS NULL OR "durationUnit" IN ('MONTH', 'DAY', 'HOUR', 'YEAR'));

ALTER TABLE crm_deal_cost DROP CONSTRAINT IF EXISTS chk_deal_cost_duration_pair;
ALTER TABLE crm_deal_cost
  ADD CONSTRAINT chk_deal_cost_duration_pair
  CHECK (("durationValue" IS NULL) = ("durationUnit" IS NULL));
