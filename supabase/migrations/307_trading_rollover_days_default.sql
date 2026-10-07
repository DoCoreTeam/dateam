-- 307_trading_rollover_days_default.sql
-- 월물 교체 기한을 3 거래일에서 1 거래일로 내린다
--
-- 왜 (실측 2026-10-07)
--   10-05 자정에 「10-08 최종거래일까지 3 거래일」로 걸려, 10월물(10-02 하루 거래량 121,719)을
--   두고 11월물(913)로 갈아탔다. 이틀 뒤 그날 거래량은 10월물 112,701 대 11월물 5,036 이었고,
--   화면과 판단 298건이 거래량 22분의 1 짜리 월물을 봤다. 현재가도 1,079.48 대 1,083.00 으로
--   3.52점 달랐다. 미니 코스피200 은 월물이 매달 있어 거래가 만기 직전에야 넘어온다.
--
-- 무엇을 바꾸나
--   표도 정책도 안 만든다. trading_settings 는 판을 쌓는 표라 UPDATE 가 아니라 다음 판을 넣는다.
--   유효일은 다음 거래일(2026-10-08)이다 — 오늘 쓸 월물은 이미 굳었고,
--   「전략 변경은 다음 거래일부터」가 이 표의 규칙이다.
--
-- 안 건드리는 것
--   관리자가 손으로 바꾼 값. 마지막 판이 레지스트리 초기값 3 그대로일 때만 넣는다.
--   이미 넣었으면 마지막 판이 1 이라 조건이 거짓이 되고 두 번 안 들어간다.

insert into trading_settings (key, value, version, source, reason, effective_trade_date)
select
  'rollover_days_before_last',
  '1'::jsonb,
  latest.version + 1,
  'init',
  '실측 2026-10-07 기한 교체로 거래량 22분의 1 월물을 이틀 봄 (10월물 112,701 대 11월물 5,036)',
  date '2026-10-08'
from (
  select value, version
  from trading_settings
  where key = 'rollover_days_before_last'
  order by version desc
  limit 1
) as latest
where latest.value = '3'::jsonb;
