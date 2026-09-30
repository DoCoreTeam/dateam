-- 294 현재가 한 줄 — **형성 중인 봉이 쓸 값**
--
-- 왜 필요한가
--   tick 이 매분 `futs_prpr`(현재가)를 받아 쓰고 **버리고 있었다**(실측 2026-09-29).
--   저장하는 자리가 없어 화면은 봉이 확정될 때만 바뀌었고, 맨 오른쪽 봉이
--   실시간으로 모양을 바꾸는 HTS 방식을 만들 재료가 없었다.
--
-- 왜 한 줄인가
--   이력은 `trading_bars` 가 이미 갖고 있다. 여기에 또 쌓으면 같은 사실이 두 곳에
--   생기고, 둘이 갈리는 날 어느 쪽이 진짜인지 아무도 모른다. 월물마다 한 줄을 덮어쓴다.
--
-- 보안 (LOOP 7절 S1)
--   표를 만드는 **같은 판에서** RLS 를 켠다. 트레이딩 표들과 같은 규칙이다 —
--   정책을 안 만들고 서비스롤(크론·서버)로만 닿는다. 사람 확인은 앱이 한다.
--   사본(create table as)을 안 만든다.

create table if not exists trading_last_price (
  contract_code   text primary key,
  -- 현재가. 못 받은 분에는 **안 덮어쓴다** — 마지막으로 성공한 값이 남아야
  -- 화면이 「값 없음」으로 깜빡이지 않는다
  price           numeric(12, 2) not null,
  -- 언제 받은 값인가. 화면이 「몇 초 전 값인지」를 말할 수 있어야 한다
  observed_at     timestamptz    not null,
  updated_at      timestamptz    not null default now()
);

comment on table trading_last_price is
  '월물별 마지막 현재가 한 줄. 형성 중인 봉이 읽는다. 이력은 trading_bars 가 갖는다';

alter table trading_last_price enable row level security;

-- 정책을 만들지 않는다. 트레이딩 표들과 같다 — 서비스롤만 닿고 사람 확인은 앱이 한다.
-- anon 에게는 아무 권한도 주지 않는다(GRANT 와 RLS 는 다른 벽이다).
revoke all on table trading_last_price from anon;
