-- 311: 가격 기준 규칙에 여덟째 종류 「규모 조정」(SCALE_CAP) (P0135 I12)
--
-- 실제 gcube edge 가격표 v0.7.0 에 「신규 견적은 라이선스 정가 소계가 GPU 수 × 728.3만원을 넘지 않도록
-- 규모 조정 할인 자동 적용」이 있다. 일곱 종류 어느 것으로도 옮길 수 없어(310 머리의 약속대로) 코드로 하나 더한다.
-- CHECK 목록을 넓히는 것뿐이다. 기존 행은 하나도 안 바뀐다.
--
-- 보안 (LOOP.md 7절): ① 새 표 없음, 있는 표의 CHECK 만 넓힘 ② 창구 없음 ③ 값의 종류 목록만 바뀜, RLS 그대로
-- 되돌리기: DELETE FROM crm_price_rule WHERE kind = 'SCALE_CAP' 뒤 310 의 CHECK 로 다시 건다.

ALTER TABLE "crm_price_rule" DROP CONSTRAINT IF EXISTS "chk_price_rule_kind";
ALTER TABLE "crm_price_rule" ADD CONSTRAINT "chk_price_rule_kind"
  CHECK ("kind" IN ('ONE_OF', 'WITH', 'INCLUDES', 'QTY_FROM', 'CAP', 'ELIGIBLE', 'DISCOUNT', 'SCALE_CAP'));
