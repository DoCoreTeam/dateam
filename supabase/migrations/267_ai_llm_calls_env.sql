-- 267: 원장에 판 구분을 남긴다 (P0030 I14)
--
-- 왜: 실측 2026-09-20 하루 23,318건 중 **어느 것이 개발 판에서 나간 것인지 가릴 방법이 없었다.**
-- 개발하는 사람의 노트북이 운영 키로 벤더를 두드리면 그 호출은 운영 한도를 쓰고 운영 원장에
-- 남는데, 원장만 봐서는 운영 사용자의 호출과 구별되지 않는다.
--
-- 기존 줄은 null 이다. 「모른다」를 'production' 으로 채우면 없던 사실을 지어내는 것이고,
-- 그 뒤로 아무도 그 값을 못 믿는다.

alter table ai_llm_calls add column if not exists env text;

comment on column ai_llm_calls.env is
  '이 호출이 나간 판 (production·preview·development·test). null 은 이 칼럼이 생기기 전 기록 (P0030 I14)';

-- 판별 집계가 흔한 질의라 날짜와 함께 센다
create index if not exists ai_llm_calls_env_created_idx
  on ai_llm_calls (env, created_at desc);

-- RLS 와 정책은 253 에서 이미 켠 그대로다. 칼럼만 더하므로 잠금은 안 바뀐다.
-- (확인: 이 판을 적용한 뒤 relrowsecurity 가 여전히 true 여야 한다)
