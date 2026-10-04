-- 303: 견적 금액을 시간당·월·기간 세 축으로 보이게 하는 칸들
--
-- GPU 처럼 시간으로 파는 것은 같은 금액을 세 가지로 말할 수 있다 — 시간당 얼마,
-- 한 달에 얼마, 그 기간 다 해서 얼마. 셋 다 맞는 말이고 고객이 어느 쪽으로 물을지는 그때 다르다.
-- 실측 2026-10-04: 그 말을 담을 칸이 없어 「providing the special discount for this two
-- months rent.(0.83*0.95*0.95=0.75 )」 처럼 할인 사유와 기간과 계산식이 비고 한 칸에 포개졌다.
--
-- **표시 선택을 성격별로 세 칸에 나눈다.** 한 칸에 접두어를 붙여 섞으면 읽을 때마다
-- 가르는 코드가 필요하고, 그 가르기가 틀리면 조용히 엉뚱한 자리에 선다.
--
-- **합계는 축을 바꿔도 안 바뀐다.** 기간요금이면 월 단가가 진짜 값이고 시간당은 그것을
-- 나눈 표시값이다. rateHoursPerMonth 가 730 이냐 720 이냐는 그 나눈 숫자만 바꾼다.
--
-- 보안: 새 표가 아니라 **있는 표 둘에 칼럼**이다. crm_quote 와 crm_quote_line 은 이미
-- RLS 가 켜져 있고 정책이 서 있으므로 이 칼럼들도 그 정책 아래 들어간다 — 따로 켤 것이 없다.
-- 사본(CREATE TABLE AS)을 만들지 않으므로 잠금이 떨어져 나갈 자리도 없다.
-- 새 칼럼에 비밀값은 없다(표시 선택과 날짜와 시간 수). 익명 권한도 건드리지 않는다.
--
-- 기존 행: 전부 NULL 허용이거나 빈 목록 기본값이라 한 행도 안 바뀐다. 백필하지 않는다 —
-- 지금까지 쓴 견적은 이 표시를 안 쓴 것이고, 켜는 것은 사람이 정할 일이다.

ALTER TABLE crm_quote
  ADD COLUMN IF NOT EXISTS "rateHoursPerMonth" integer,
  ADD COLUMN IF NOT EXISTS "rateAxisKeys" text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS "lineNoteKeys" text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS "totalConvKeys" text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN crm_quote."rateHoursPerMonth" IS
  '월 기준 시간 — 한 달을 몇 시간으로 셀지. 시간당을 함께 인쇄할 때만 쓰이고 합계는 안 바뀐다. 비면 설정 기본값(730)';
COMMENT ON COLUMN crm_quote."rateAxisKeys" IS
  '금액 칸에 함께 인쇄할 축 — total(기간 총액)·monthly(월 금액)·hourly(시간당 금액). 복수 선택, 빈 목록이면 합계 하나만';
COMMENT ON COLUMN crm_quote."lineNoteKeys" IS
  '품목 이름 아래 한 줄로 이어 붙는 것 — period(기간)·totalHours(총 시간)·hoursBasis(월 기준 시간)·wasAndDiscount(정상가와 할인)';
COMMENT ON COLUMN crm_quote."totalConvKeys" IS
  '합계 영역에 서는 환산 줄 — monthly(월 환산)·hourly(시간당 환산). 원화 환산과 같은 자리, 같은 꼴';

/*
  **범위를 DB 에서도 막는다.** 화면과 서버가 이미 거르지만, 그 둘을 지나지 않는 길
  (관리자 도구·다른 세션의 스크립트)이 생기면 1 같은 값이 들어와 시간당이 월 단가와 같아진다.
  1 시간부터 8784 시간(윤년 366일 × 24h)까지만 받는다.
*/
ALTER TABLE crm_quote
  DROP CONSTRAINT IF EXISTS chk_quote_rate_hours;
ALTER TABLE crm_quote
  ADD CONSTRAINT chk_quote_rate_hours
  CHECK ("rateHoursPerMonth" IS NULL OR ("rateHoursPerMonth" >= 1 AND "rateHoursPerMonth" <= 8784));

ALTER TABLE crm_quote_line
  ADD COLUMN IF NOT EXISTS "startDate" timestamp(3),
  ADD COLUMN IF NOT EXISTS "endDate" timestamp(3);

COMMENT ON COLUMN crm_quote_line."startDate" IS
  '공급 시작일 — 견적 유효기간(crm_quote.validUntil)과 다르다. 딜의 기간에서 가져온다';
COMMENT ON COLUMN crm_quote_line."endDate" IS
  '공급 종료일 — 시작일과 함께 개월과 총 시간을 센다';

/*
  **끝이 시작보다 앞설 수 없다.** 둘 중 하나만 적는 것은 허용한다 —
  시작만 알고 끝은 협의 중인 견적이 실제로 있다(딜에 endDateUnknown 칸이 따로 있는 이유).
*/
ALTER TABLE crm_quote_line
  DROP CONSTRAINT IF EXISTS chk_quote_line_period;
ALTER TABLE crm_quote_line
  ADD CONSTRAINT chk_quote_line_period
  CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "endDate" >= "startDate");
