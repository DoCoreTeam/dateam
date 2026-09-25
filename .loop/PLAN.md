# PLAN newAX: 만든 것이 실제로 불리게 한다 — 체결 인식·포지션·손익·게이트 값·주문 배선
플랜 ID: P0064
플랜 버전: v0.1.3
상태: 진행중
지시: ins_0111
목표 버전: v0.10.536
작성: 2026-09-25
시작 커밋: d4a5e9b2

## 목표
- 봉·판단·신호까지는 실데이터가 흐르는데 그 뒤가 전부 고정값이라 안전장치가 **구조적으로 안 걸린다**
  실측: 손절 이탈 알림은 `stopPrice: null` 이라 영원히 안 나가고, 일일 손실 한도는 `closedTrades: []` 라 항상 0원이며, 자동 주문은 `acct: null` 이라 무장해도 아무 일도 안 난다
- 체결을 읽어 우리 기록을 세우고, 그 기록이 감시·게이트·주문에 실제로 들어가게 한다

## 범위 밖
- 관문(§13.5) 통과와 무장 켜기 — 20거래일 실적이 필요한 일이고 코드가 만들 수 있는 것이 아님
- 새 화면 — 이번 판은 이미 있는 자리에 값이 가게 하는 일

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- `AccountClient` 의 메서드 넷이 전부 불린다 (지금은 `positions` 하나만)
- `trading_fills` 에 쓰는 자리가 있다 (지금 0곳)
- `runWatch`·`runOrderJob` 에 넘기는 고정값이 0개 — 전부 재거나, 못 재면 왜 못 재는지 한 줄
- 새 가드가 「객체 메서드를 안 부르는 자리」와 「고정값으로 넘기는 자리」를 센다
- 사용자 노출 문자열은 전부 i18n 키 사용
- 설정값은 env 추가 없이 DB 저장 + UI 관리

## 참조
- newplan/TRD/AI_TRADING_SPEC.md §3.2 1-C(체결 인식·대조, 손익·시각 기록), §10.2, §14.3
- docs/trading/RELEASE4_DESIGN.md §4 주문 순서
- LOOP.md 7절 보안 기준

## 항목

### I01 체결을 읽어 기록한다
상태: 통과
모드: 경량
범위: apps/web/lib/trading/position/fills-core.ts (신규), apps/web/lib/trading/position/fills-core.test.ts (신규), apps/web/lib/trading/position/fills.ts (신규), apps/web/lib/trading/broker/account-request.ts, apps/web/lib/trading/jobs/watch.ts, apps/web/lib/trading/jobs/tick.ts, supabase/migrations/288_trading_fill_times.sql (신규), apps/web/package.json
감사 기준:
- `account.fills(tradeDate)` 를 불러 `trading_fills` 에 넣는다, 같은 체결이 두 번 안 들어간다(PK `order_no,fill_seq`)
- **체결 시각을 지어내지 않는다** — KIS 주문체결내역에 체결시각 칼럼이 없다(실측: 공식 저장소 COLUMN_MAPPING 33개에 `ccld_tmd` 없음). 마이그 288 이 `filled_at` 을 null 허용으로 바꾸고 `first_seen_at`(상한)을 더한다, 주문 시각이 하한
- 수수료(`fee_smtl`)를 받아 적는다 — 체결 재현(§13.2)이 비용을 본다
- 조회 실패는 던지지 않고 사유를 돌려준다 — 곁가지가 본 일을 죽이지 않는다
- **계좌 창구는 한 벌이다** — tick 이 `AccountClient` 를 하나 만들어 감시와 체결이 같이 쓴다, 속도 제한 큐가 둘이면 제한을 두 배로 넘긴다
- `pnpm test` 에 등재하고 통과, 배선 가드가 초록
- 보안: 표에 쓴다(세 질문 ①) → 마이그 288 은 칼럼만 바꾸고 RLS 를 안 건드린다, `trading_fills` 가 여전히 RLS 켜짐·정책 0개·service_role 전용임을 psql 로 확인, 앱은 `createAdminClient` 로만 쓴다
의존: 없음

### I02 체결에서 우리 포지션을 세운다
상태: 대기
모드: 경량
범위: apps/web/lib/trading/position/from-fills.ts (신규), apps/web/lib/trading/position/from-fills.test.ts (신규), apps/web/package.json
감사 기준:
- 체결 줄을 접어 `수량·방향·평균가`를 낸다, 사고 판 것이 같으면 `flat`
- 닫힌 거래를 `RealizedTrade` 로 낸다 — `dayPnl` 이 바로 먹을 수 있는 꼴
- 같은 분에 여러 체결이 와도 순서대로 접는다
- `pnpm test` 에 등재하고 통과
- 보안: 해당 없음 — 순수 계산 모듈이고 표·창구·외부 호출이 없음
의존: I01

### I03 감시에 실값을 넣는다
상태: 대기
모드: 경량
범위: apps/web/lib/trading/jobs/tick.ts
감사 기준:
- `expected`·`positionState`·`direction`·`stopPrice`·`closedTrades`·`observedPrice` 가 고정값이 아니다
- `stopPrice` 는 그 포지션을 만든 신호에서 온다, 신호를 못 찾으면 null 이고 사유가 실행 기록에 남는다
- 일부러 깨기: 손절가를 지난 값을 넣으면 `protection_breached` 가 대기 표에 들어간다 (운영 DB 는 BEGIN·ROLLBACK)
- 보안: 표를 읽고 쓴다(세 질문 ①) → 새 표 없음, 모두 service_role 전용 기존 표이고 `createAdminClient` 경유임을 확인
의존: I02

### I04 게이트 값을 실제로 잰다
상태: 대기
모드: 경량
범위: apps/web/lib/trading/gate/measure.ts (신규), apps/web/lib/trading/gate/measure.test.ts (신규), apps/web/lib/trading/jobs/tick.ts, apps/web/package.json
감사 기준:
- `brokerFailureStreak` 가 **실제 최근 조회 결과**로 센다 — 지금은 `[{ok:false}]` 를 손으로 만들어 넘겨 늘 1 이다
- `minutesSinceLastRun`·`hasCalibration`·`hasActiveSpec`·`marginTight`·`aiBudgetExhausted` 를 잰다, `marginTight` 는 `account.deposit()` 에서 온다
- 못 재는 것은 `false` 대신 그 이유를 실행 기록에 남긴다
- `pnpm test` 에 등재하고 통과
- 보안: 밖에서 온 값을 다룬다(세 질문 ③) → KIS 증거금 응답을 숫자로 바꿀 때 `Number.isFinite` 로 거르고, 못 읽으면 「여유 있음」이 아니라 「모름」으로 둔다
의존: I01

### I05 주문에 계좌와 관문을 넘긴다
상태: 대기
모드: 중량
범위: apps/web/lib/trading/jobs/tick.ts, apps/web/lib/trading/order/pending.ts (신규), apps/web/lib/trading/order/pending.test.ts (신규), apps/web/package.json
감사 기준:
- `acct`·`auth`·`armCtx`·`pendingEntry`·`openPosition`·`openOrderNos` 가 고정값이 아니다
- `pendingEntry` 는 **아직 주문 안 낸 신호**만 — `trading_orders` 에 같은 신호의 `entry` 가 있으면 안 나온다
- `openOrderNos` 는 `account.openOrders()` 에서 온다
- 무장이 꺼져 있으면 여전히 `order=not_armed` 로 끝난다 — 배선이 무장을 켜지 않는다
- 일부러 깨기: 무장 표를 BEGIN 안에서 켜도 `checkArming` 이 막는 줄이 남는지 확인 후 ROLLBACK
- 보안: 새 창구를 여나(②) 아니오, 표에 쓰나(①) 예 → `trading_orders` 가 RLS 켜짐·정책 0개임을 확인, 주문 인증은 `createAdminClient` 뒤에서만 만들어지고 화면으로 안 나간다
의존: I02, I04

### I06 재 본 값을 화면에 보인다
상태: 대기
모드: 경량
범위: apps/web/lib/trading/overview.ts, apps/web/lib/trading/overview-shape.ts, apps/web/app/(member)/trading/OperatorPanel.tsx
감사 기준:
- 오늘 실현 손익과 들고 있는 포지션이 화면에 뜬다, 못 잰 값은 숫자 0 이 아니라 「모름」으로 뜬다
- 사용자 노출 문자열에 전각 대시가 없고 용어집 금지어가 없다
- `pnpm test` 전체 통과
- 보안: 해당 없음 — 읽기만 하고 기존 소유자 접근 게이트 안에 있음
의존: I03

### I07 가드가 못 보던 둘을 세게 한다
상태: 대기
모드: 경량
범위: apps/web/lib/policy/trading-wiring-guard.test.ts
감사 기준:
- 공장이 돌려주는 client 인터페이스의 메서드 중 아무도 안 부르는 것을 센다, 이 시점에 0개
- `runWatch`·`runOrderJob` 에 넘기는 고정값을 센다, 남은 것은 사유와 함께 예외 목록에 있고 「아직 안 했다」는 사유로 안 받는다
- 콜백 묶음(`BacktestParams`·`TickPorts`)을 오탐하지 않는다
- 일부러 깨기: `positions()` 호출을 지우면 빨개지고, `closedTrades` 를 `[]` 로 되돌리면 빨개진다
- 보안: 해당 없음 — 가드 파일만 바꿈
의존: I05, I06

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-25) 최초 작성 (ins_0111)
- v0.1.1 (2026-09-25) 가드를 맨 앞에서 맨 뒤로 (audit:I01)
- v0.1.2 (2026-09-25) I01 에 마이그 288 을 더함, KIS 가 체결 시각을 안 준다 (audit:I01)
- v0.1.3 (2026-09-25) I01 이 계좌 창구를 한 벌로 합침, 큐가 둘이면 속도 제한을 넘긴다 (audit:I01)
- v0.1.1 (2026-09-25) 가드를 맨 앞에서 맨 뒤로 옮겼다. 가드가 지금 상태를 잡으면 플랜 내내 빨갛고, 그러면 어느 항목도 통과 못 한다. 배선을 먼저 하고 가드로 잠근다 (audit:I01)
- v0.1.2 (2026-09-25) KIS 주문체결내역에 체결시각 칼럼이 없다는 것을 공식 저장소에서 확인했다. filled_at 이 NOT NULL 이라 주문 시각을 넣으면 체결 지연이 조용히 0 이 된다. 마이그 288 로 null 허용 + first_seen_at 상한을 더해 하한과 상한으로 둔다 (audit:I01)
- v0.1.3 (2026-09-25) 체결 조회를 붙이려니 AccountClient 를 또 만들게 됐다. 속도 제한 큐가 둘이면 KIS 제한을 두 배로 넘긴다. tick 이 한 벌 만들어 감시와 체결이 같이 쓰게 범위를 넓힌다 (audit:I01)
