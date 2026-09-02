-- 240_ci_signal_success_at.sql — 「시도한 때」와 「성공한 때」를 나눈다
--
-- 왜 필요한가(실측 2026-09-02):
--   `last_signal_sweep_at` 은 잡을 **거는 시점**에 찍는다(중복 훑기 방지). 그런데 화면이
--   그 값을 「마지막으로 성공한 때」로 읽어, 실패한 뒤에도 「새 이슈 없음」이라고 말했다.
--   실제로는 한도로 실패한 상태였고, 그 오판 때문에 짧은 재시도(1시간)까지 꺼졌다.
--
--   시도와 성공은 다른 사실이다. 한 칸에 두 뜻을 담으면 반드시 한쪽이 틀린다.

alter table ci_workspaces
  add column if not exists last_signal_success_at timestamptz;

comment on column ci_workspaces.last_signal_sweep_at is
  '이슈 수집을 마지막으로 **시도**한 시각(잡을 건 시점). 다음 주기 계산의 기준';
comment on column ci_workspaces.last_signal_success_at is
  '이슈 수집이 마지막으로 **성공**한 시각. 자동·수동 어느 경로든 성공했을 때만 찍는다';
