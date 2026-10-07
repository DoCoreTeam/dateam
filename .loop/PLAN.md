# PLAN newAX: 월물 교체가 거래량을 보고 정해진다
플랜 ID: P0121
플랜 버전: v0.1.5
상태: 진행중
지시: ins_0206
목표 버전: v0.10.985
작성: 2026-10-07
시작 커밋: 4f2ac3f1

## 목표
- 월물 교체가 거래량을 보고 정해진다. 차월물이 근월물보다 얇으면 최종거래일 하루 전까지 안 갈아탄다
- 왜 그 월물을 보고 있는지가 실행 기록과 화면에 남는다. 다음에 어긋나면 눈으로 보인다

## 범위 밖
- 오늘 굳은 월물을 장중에 되돌리는 일. 오늘 봉이 전부 A05611 이라 바꾸면 차트가 통째로 비고, 내일 10-08 이 A05610 최종거래일이라 하루 쓰자고 만기 당일 월물로 옮기는 셈이다. 규칙만 고치고 적용은 다음 자정 판정부터
- 야간장 시세 창구 신설. 야간 분봉 경로와 tr_id 를 모르고, 지어내면 엉뚱한 값이 봉으로 쌓인다 (night-quote.ts 가 적어 둔 그대로)
- 계좌 조회 실패 APAC0071. 증권사에 그 계좌번호가 없다는 뜻이고 사람이 설정에서 계좌번호를 다시 넣어야 풀린다
- 이미 쌓인 10-06 과 10-07 의 A05611 봉과 판단 298건. 지우지 않는다. 그날 실제로 본 것이 그것이고 백테스트가 그 사실을 알아야 한다

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 차월물이 근월물보다 얇은데 기한만으로 갈아탄 경우를 사유에서 가려 읽을 수 있다
- 월물을 굳히는 실행(자정, 장 밖)의 기록에 교체 사유가 남는다
- 현황 머리글이 보고 있는 월물의 당일 거래량과 그것이 거래소 근월물인지를 말한다
- 설정값은 env 추가 없이 DB 저장과 UI 관리

## 참조
- LOOP.md 7절 보안 기준, 9절 U-N 화면 문구 · F-N 기능 완결성
- apps/web/lib/trading/contracts/roll.ts 머리글 (교체 규칙의 뜻)
- 실측 2026-10-07 14:2x KIS: A05610 현재가 1079.48 거래량 112701 미결제 49836, A05611 현재가 1083.00 거래량 5036 미결제 21399

## 항목

### I01 기한이 거래량을 덮지 않는다
상태: 통과
모드: 경량
범위: apps/web/lib/trading/contracts/contract-rules.ts, apps/web/lib/trading/contracts/contract-rules.test.ts, apps/web/lib/trading/contracts/roll.ts, apps/web/lib/trading/contracts/roll.test.ts
감사 기준:
- shouldRollover 가 거래량 역전을 기한보다 먼저 본다. nextVolume > frontVolume 이고 기한도 걸린 입력에서 사유가 next_volume_exceeded 다
- 차월물이 아직 얇은데 기한으로 갈아탄 경우의 사유가 따로 난다. frontVolume 121719 nextVolume 913 tradingDaysUntilLast 3 daysBefore 3 입력에서 roll 은 true 이고 사유가 deadline_reached 와 구분되는 값이다
- 기존 사유 세 값(next_volume_exceeded, deadline_reached, front_still_heavier)을 쓰는 자리가 새 값을 다 받는다. pnpm tsc --noEmit 통과
- 일부러 깨뜨려 확인: 거래량 비교를 지운 판으로 돌리면 새 단정이 실패한다
의존: 없음

### I02 월물을 굳히는 실행이 교체 사유를 기록에 남긴다
상태: 통과
모드: 경량
범위: apps/web/lib/trading/jobs/tick.ts, apps/web/lib/trading/jobs/tick-core.ts, apps/web/lib/trading/jobs/tick-core.test.ts, apps/web/lib/trading/operator/run-reason.ts, apps/web/lib/trading/operator/run-reason.test.ts
감사 기준:
- 장 밖 조기 반환(market_closed=, no_night_quote)이 syncReason 을 버리지 않는다. 자정에 굳히는 실행의 reason 에 roll= 또는 roll_no= 가 들어 있다
- 실측 대조: trading_job_runs 의 2026-10-05 00:00 줄에 교체 사유가 없다는 것이 지금 상태다. 고친 뒤 같은 모양의 입력에서 사유가 나온다는 단위 단정을 둔다
- 이미 쓰고 있는 사유 문자열의 앞 토막(market_closed=before_open 등)이 그대로 남는다. run-reason 이 읽는 정규식이 안 깨진다
의존: I01

### I03 기한 보루를 최종거래일 하루 전으로 내린다
상태: 통과
모드: 중량
범위: apps/web/lib/trading/settings/registry.ts, supabase/migrations/307_trading_rollover_days_default.sql(신규), apps/web/lib/trading/settings/registry.test.ts, apps/web/lib/trading/jobs/tick.ts
감사 기준:
- registry 의 rollover_days_before_last 기본값이 1 이다
- 마이그레이션이 trading_settings 의 그 키를 3 일 때만 1 로 내린다. 관리자가 바꾼 다른 값은 안 건드린다. trading_settings 는 판을 쌓는 표라 UPDATE 가 아니라 다음 판을 넣고, 유효일은 다음 거래일이다
- 코드가 같은 숫자를 또 적지 않는다. tick.ts 의 num('rollover_days_before_last', 3) 이 레지스트리 기본값을 읽는다
- 보안: 새 표도 새 창구도 안 만든다. 기존 trading_settings 한 줄 UPDATE 뿐이고 RLS 와 GRANT 를 안 바꾼다는 것을 마이그레이션 내용으로 확인하고, pnpm test 의 rls-baseline 과 api-auth-surface 가 그대로 통과한다
- 적용 뒤 psql 로 값이 1 인지 확인하고 결과를 적는다
의존: I01

### I03a 숫자 기본값이 코드와 레지스트리에서 안 갈린다
상태: 통과
모드: 경량
범위: apps/web/lib/trading/settings/registry.test.ts, apps/web/lib/trading/settings/registry.ts, apps/web/lib/trading/jobs/tick.ts, apps/web/lib/trading/order/pending.ts, apps/web/lib/trading/validation/pipeline.ts
감사 기준:
- I03 을 하다 드러난 것: 코드가 설정 키에 숫자 기본값을 또 적는데 그 값이 레지스트리와 다른 자리가 셋이다. daily_loss_limit_krw 는 레지스트리 500000 인데 코드가 0, daily_target_krw 는 300000 인데 코드가 0. 저장된 값이 없는 환경에서는 화면이 말하는 한도와 판단이 쓰는 한도가 갈린다
- 가드가 「코드에 적힌 숫자 기본값이 레지스트리와 다른 자리」를 0 건으로 센다. 값이 같은 자리는 안 잡는다(54곳이 그렇고 이번에 고칠 일이 아니다)
- 세 자리가 numberDefault 를 읽는다
- 일부러 깨뜨려 확인: 한 자리를 다른 숫자로 되돌리면 가드가 그 자리를 짚는다
의존: I03

### I04 머리글이 보고 있는 월물의 두께를 말한다
상태: 통과
모드: 경량
범위: apps/web/lib/trading/overview-labels.ts, apps/web/lib/trading/overview-labels.test.ts, apps/web/lib/trading/overview.ts, apps/web/lib/trading/overview-shape.ts, apps/web/lib/trading/contracts/today-contract.ts
감사 기준:
- 머리글이 당일 거래량을 함께 적는다. 오늘 값으로 「미니 코스피200 선물 2026년 11월물 (A05611)」 뒤에 거래량이 붙는다
- 보고 있는 월물이 거래소 근월물이 아니면 그 사실을 말한다. trading_contracts.is_front 가 다른 코드일 때만 뜨고, 같으면 아무 말도 안 붙는다
- 문구에 지어낸 말을 안 쓴다. lib/terms 와 product-copy 가드 통과
- 거래량을 못 읽었으면 0 이라고 쓰지 않고 그 자리를 비운다
의존: I01

### I05 실브라우저에서 머리글을 확인한다
상태: 통과
모드: 경량
범위: 없음(확인만)
감사 기준:
- 로컬 운영 판으로 /trading 을 열어 머리글에 거래량과 근월물 아님 표시가 뜨는 것을 눈으로 본다
- 못 돌렸으면 못 돌렸다고 적는다 (LOOP.md 9절 F-10)
의존: I04

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-10-07) 최초 작성 (ins_0206)
- v0.1.1 (2026-10-07) I01 범위에 roll.ts 추가, 교체 사유 union 이 넓어져 RollResult 가 새 값을 받아야 tsc 가 통과한다 (audit:I01)
- v0.1.2 (2026-10-07) I01 범위에 roll.test.ts 추가, 기한 교체 단정이 실측 그대로의 얇은 입력을 쓰고 있어 새 사유로 갈라 적어야 한다 (audit:I01)
- v0.1.3 (2026-10-07) I02 범위에 run-reason 추가, 교체 표식이 신호 쪽 roll= 과 이름이 겹쳐 contract_roll 로 가르고 그 말을 사람 말로 읽는 규칙을 둔다 (audit:I02)
- v0.1.4 (2026-10-07) I03 범위에 tick.ts 추가(레지스트리를 내려도 코드가 3 을 또 적고 있었다). I03a 추가, 같은 모양으로 레지스트리와 어긋난 자리 셋을 발견했다(daily_loss_limit_krw 0 대 500000 등) (audit:I03)
- v0.1.5 (2026-10-07) I03a 범위에 registry.ts 추가, I03 에서 늘린 도움말이 60자 한도를 넘어 copy 가드가 잡았고 그 자리를 같이 줄인다 (audit:I03a)
