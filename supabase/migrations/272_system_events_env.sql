-- 272: 사건이 **어느 판에서 났는지** 남긴다 — 로컬에서 난 일을 운영이 막혔다고 말하지 않게
--
-- 왜: 관리자 화면이 「지금 막혀 있는 것 2건」이라고 빨갛게 말하고 있었는데,
--   그 두 줄을 포함한 db 사유 125건이 **전부 개발자 노트북 스택**이었다
--   (원문에 /Users/... 경로가 그대로 들어 있다). 운영에서는 0건이었다.
--   관리자는 그 화면을 보고 「지금 서비스가 죽었나」를 판단한다. 판을 안 적어 두면
--   개발 중에 난 일이 운영 장애로 읽히고, 그 화면은 곧 아무도 안 믿게 된다.
--
-- 왜 기본값을 'production' 으로 안 두나
--   이미 쌓인 18,647행이 어느 판에서 났는지 **우리는 모른다.** 모르는 것을 운영이라고
--   적으면 그건 지어낸 사실이다. 그래서 칼럼은 널을 허용하고, 원문이 스스로 증명하는
--   것만 아래에서 채운다. 널은 「모름」이고 화면은 모름을 숨기지 않는다 —
--   증명된 로컬만 접는다.
--
-- 왜 raw 로 백필하나
--   스택에 박힌 경로가 유일하게 남아 있는 증거다. /Users/… 는 개발자 기계이고
--   localhost 는 그 기계의 브라우저다. /var/task/ 는 Vercel 이다.

alter table public.system_events
  add column if not exists env text;

comment on column public.system_events.env is
  '이 사건이 난 판. production·preview·development·test, 널은 칼럼이 생기기 전이라 모름';

-- 원문이 스스로 증명하는 것만 채운다. 나머지는 널(모름)로 둔다
update public.system_events
   set env = 'development'
 where env is null
   and (raw like '%/Users/%' or raw like '%localhost:%' or raw like '%127.0.0.1%');

update public.system_events
   set env = 'production'
 where env is null
   and (raw like '%/var/task/%' or raw like '%.vercel.app%');

-- 화면 기본값이 「운영과 모름」이라 그 조건으로 훑는다
create index if not exists idx_system_events_env
  on public.system_events (env, occurred_at desc);

-- RLS 는 218 에서 이미 켰고 정책 셋이 그대로다. 칼럼을 더하는 것은 정책을 안 건드린다.
-- 다만 «켰겠지»로 넘기지 않는다 — 이 판이 끝난 뒤 실제로 세어 확인한다(LOOP.md 7절).
