# PLAN newAX: 크론이 못 모으는 것을 말하고, 헛일을 멈춘다
플랜 ID: P0086
플랜 버전: v0.1.3
상태: 진행중
지시: ins_0144
목표 버전: v0.10.681
작성: 2026-09-29
시작 커밋: 9af24448

## 목표
- 야간에 낮 창구로 되풀이 조회하는 헛일을 멈추고, 못 모으는 이유를 기록과 화면이 말한다
- 야간 세션 줄이 장이 안 서는 저녁에 안 생긴다 (토·일 저녁, 그리고 금요일 밤의 귀속 거래일)
- 증권사 조회가 죽었을 때 무엇이 왜 죽었는지 남는다 (지금은 http_500 한 마디뿐)
- 수집을 시작하기 전 날과 수집 중인데 빠진 날을 화면이 가른다

## 범위 밖
- 야간 분봉 조회 창구를 새로 붙이는 것 (KIS 의 야간 분봉 경로·tr_id 를 이 저장소가 모른다,
  추측해서 박으면 조용히 틀린다. 이번 판은 「모른다」를 정확히 말하는 데까지)
- 지난 평일(9/21~9/25) 봉을 만들어 내는 것 (크론이 9/26 에 처음 돌았다, 없는 과거는 코드로 못 만든다.
  화면의 CSV 채우기가 그 자리를 이미 맡는다)
- KIS 계좌번호 교정 (사용자만 아는 값, fills_failed:kis_APAC0071)

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test 통과
- 야간 시간대에 크론이 낮 분봉 창구를 안 부른다 (부르는 자리를 가드가 센다)
- 실행 기록의 사유가 「무엇이 없어서 못 모았나」를 말한다 (bar_not_ready 한 마디로 안 끝난다)
- 로컬 :3000 에서 운영·자료 화면이 200 이고 못 모으는 사실을 사람 말로 말한다

## 참조
- LOOP.md 7절 보안 기준
- 실측 2026-09-29: 최근 크론 1000회 중 bar_not_ready 476 · http_500 76 · market_closed 134
- 실측: 첫 크론 9/26 01:37, 첫 봉 9/28 08:48, 야간 봉 0건 (두 번의 야간 창 동안)
- lib/trading/broker/endpoints.ts 의 NIGHT_EQUIVALENT (계좌 조회는 낮·밤 짝이 있고 시세 조회는 없다)

## 항목

### I01 야간 세션 줄이 장이 안 서는 저녁에 안 생긴다
상태: 통과
모드: 경량
범위: lib/trading/calendar/session.ts, lib/trading/calendar/night.test.ts, lib/trading/calendar/seed.ts, lib/trading/calendar/night-signal.test.ts
감사 기준:
- 토요일·일요일 저녁에는 야간 세션 줄을 안 만든다 (실측: trade_date 2026-09-27 night 는 토요일 저녁에 만든 줄이고 그런 장은 없다)
- 금요일 밤의 귀속 거래일이 토요일이 아니라 다음 거래일이다 (nightTradeDate 가 달력 하루가 아니라 거래일로 센다)
- ensureSessionWindow 는 주말을 보는데 ensureNightWindow 는 안 본다 — 같은 규율을 둘 다 지난다
- 가드가 금·토·일 저녁 세 경우를 확인하고, 주말 검사를 지운 판에서 실패한다 (깨뜨려 확인)
- 보안: 새 표도 새 창구도 없다, 쓰는 표는 이미 이 함수가 쓰던 것 — 해당 없음
의존: 없음

### I02 야간에 낮 분봉 창구를 되풀이 부르지 않는다
상태: 통과
모드: 경량
범위: lib/trading/bars/night-quote.ts (신규), lib/trading/bars/night-quote.test.ts (신규), lib/trading/jobs/tick.ts, lib/trading/jobs/tick-core.ts, lib/trading/jobs/tick-core.test.ts
감사 기준:
- 야간 세션에서 분봉을 부르기 전에 「이 세션에 쓸 조회 창구가 있나」를 묻고, 없으면 안 부른다 (실측: 최근 1000회 중 bar_not_ready 476회가 이 헛일이다)
- 없다는 사실이 실행 사유에 남는다 — bar_not_ready 가 아니라 「야간 분봉 창구가 없다」로 적힌다
- 계좌 조회의 NIGHT_EQUIVALENT 와 같은 꼴로 시세 조회의 낮·밤 짝을 선언하고, 야간 짝이 비어 있다는 것을 값으로 둔다 (주석으로만 적지 않는다)
- 가드가 「야간 짝이 채워진 판」과 「빈 판」 두 경우를 확인하고, 되풀이 조회를 되살린 판에서 실패한다 (깨뜨려 확인)
- 보안: 밖으로 나가는 주소는 여전히 코드 상수뿐, 새 주소를 안 더한다 (S4)
의존: 없음

### I03 증권사 조회가 죽으면 무엇이 왜 죽었는지 남는다
상태: 통과
모드: 경량
범위: lib/trading/broker/kis-request.ts, lib/trading/broker/kis-client.ts, lib/trading/broker/account.ts, lib/trading/broker/kis-client.test.ts
감사 기준:
- 실패 사유가 http_500 한 마디가 아니라 어느 조회가 어떤 벤더 코드로 죽었는지 담는다 (실측: 최근 1000회 중 76회가 http_500 이고 전부 같은 한 줄이었다)
- 벤더 원문을 그대로 안 싣는다 — 키 조각이 섞여 오므로 코드와 우리 말만 남긴다 (S3)
- 가드가 「벤더 코드가 있는 실패」와 「없는 실패」 두 경우를 값으로 확인한다
- 보안: 오류 메시지에 내부 구조·비밀을 안 싣는다 (S3)
의존: 없음

### I04 수집 시작 전 날과 빠진 날을 가른다
상태: 통과
모드: 경량
범위: lib/trading/bars/coverage-labels.ts, lib/trading/bars/coverage-labels.test.ts, lib/trading/overview-shape.ts, lib/trading/overview.ts, app/(trading)/trading/BarCoverage.tsx
감사 기준:
- 크론이 처음 돌기 전 날은 「아직 안 모은 날」이 아니라 「수집 시작 전」이다 (실측: 첫 크론 9/26 01:37, 그 앞 평일 9/21~9/25 는 코드로 못 만드는 과거)
- 그 줄에 무엇을 하면 되는지 적는다 (CSV 로 봉 채우기가 이미 그 자리에 있다)
- 가드가 「시작 전」·「주말」·「안 모은 날」 셋을 가르고, 한 말로 되돌린 판에서 실패한다 (깨뜨려 확인)
- 보안: 문자열과 판정만 바뀜 — 해당 없음
의존: 없음

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-29) 최초 작성 (ins_0144)
- v0.1.2 (2026-09-29) I01 범위 정정 — seed-window 는 안 건드렸고, 대신 night-signal.test.ts 가 옛 셈법(금요일 밤 → 토요일)을 예시로 박고 있어 사실만 고침 (audit:I01)
- v0.1.1 (2026-09-28) I01 범위 정정, night-signal.test.ts 포함 (audit:I01)
- v0.1.4 (2026-09-29) I02 범위 정정 — endpoints.ts 는 안 건드렸고(주소를 안 더하는 것이 이 항목의 뜻), 대신 판정이 사는 tick-core.ts 와 그 가드가 들어감 (audit:I02)
- v0.1.2 (2026-09-28) I02 범위 정정 (audit:I02)
- v0.1.6 (2026-09-29) I03 범위 정정 — 새 모듈이 필요 없었다, 사유를 만드는 자리(readEnvelope)가 이미 한 곳이라 거기에 「어느 조회」와 벤더 코드를 실었다 (audit:I03)
- v0.1.3 (2026-09-28) I03 범위 정정, 새 모듈 대신 readEnvelope 보강 (audit:I03)
