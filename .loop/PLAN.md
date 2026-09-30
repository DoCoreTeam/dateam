# PLAN newAX: 현재봉이 실시간으로 모양을 바꾸고 휠로 차트를 움직인다
플랜 ID: P0089
플랜 버전: v0.3.0
상태: 진행중
지시: ins_0147
목표 버전: v0.10.720
작성: 2026-09-29
시작 커밋: 84667646

## 목표
- 맨 오른쪽 봉이 **형성 중인 봉**이 되어 값이 들어올 때마다 고가·저가·종가가 움직임 (사용자 지시 2026-09-29 「실시간으로 계속 데이터를 받으면서 모양이 변하더라고 그렇게 구현해 실시간으로 이거 중요한거야」)
- 마우스 휠로 차트를 움직임 (같은 지시 「차트 스크롤을 마우스 휠로 할 수 있어야 한다는 말이었어」)
- 실측 2026-09-29: tick 이 매분 현재가(`futs_prpr`)를 받아 쓰고 **버린다**. 저장하는 자리가 없어 화면이 분 단위로만 바뀐다
- **화면에서 봉 단위를 고름** (1·3·5·10·15·30·60분) — 지금은 1분 고정이라 하루를 보려면 수백 개를 그려야 하고, HTS 는 어디나 고르게 되어 있음 (사용자 지시 2026-09-30 「그걸 구분해서 고르게 하던가 그것도 좋은 방법이네」)

## 범위 밖
- 형성 중인 봉을 **지표·판단·채점에 넣는 것** — 확정 안 된 값으로 판단하면 그 판단은 되돌아볼 수 없다(M5). 이 플랜은 그림만 바꾼다
- WebSocket 수집 — 증권사 실시간 시세 채널은 따로 파야 하고, 그 전에 REST 로도 모양이 변하는 것을 볼 수 있다
- **판단 봉 단위(`decision_tf`)를 바꾸는 것** — 화면에서 고르는 것은 **보는 단위**고, 시스템이 판단하는 단위는 다른 문제다. 판단 단위를 바꾸면 그 전 판단과 성적을 못 견주고 보정·기대값표를 다시 쌓아야 한다. 채점기가 붙었으니 숫자로 답할 수 있는 일이고, 별도 플랜이다
- 묶음 봉을 **표에 더 쌓는 것** — 화면 봉은 1분봉을 그 자리에서 묶어 그린다(`aggregateBars` 가 이미 있고 시험도 있다). 같은 사실을 두 곳에 쌓으면 갈린다

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 사용자 노출 문자열은 라벨 SSOT 를 지남
- 설정값은 env 추가 없이 DB 저장 + UI 관리
- 형성 중인 봉이 **확정 봉과 눈으로 구분됨**, 그리고 지표·채점에 안 들어감을 가드가 셈

## 참조
- 현재가 출처: `lib/trading/broker/endpoints.ts` 의 `price` (FHMIF10000000, `futs_prpr`)
- 지금 부르는 자리: `lib/trading/jobs/tick.ts:363` — 받아서 `observedPrice` 로 쓰고 저장은 안 함
- 차트 창: `lib/trading/chart/series.ts` 의 `defaultWindow` (상한 120봉)

## 항목

### I01 현재가를 남긴다
상태: 통과
모드: 경량
범위: supabase/migrations/294_trading_last_price.sql (신규), apps/web/lib/trading/bars/last-price.ts (신규), apps/web/lib/trading/bars/last-price.test.ts (신규), apps/web/lib/trading/jobs/tick.ts, apps/web/package.json
감사 기준:
- tick 이 받은 현재가(`futs_prpr`)를 표에 남긴다 — 지금은 받아서 쓰고 버린다
- 표는 월물마다 **한 줄**이다 (계속 덮어씀), 이력은 봉이 이미 갖고 있으므로 또 쌓지 않는다
- 값을 못 받은 분에는 **안 덮어쓴다** — 마지막으로 성공한 값이 남아야 화면이 「값 없음」으로 깜빡이지 않는다
- 언제 받은 값인지(`observed_at`)를 같이 남긴다, 화면이 「몇 초 전 값인지」를 말할 수 있어야 한다
- **RLS 를 같은 마이그레이션에서 켠다** (S1) — `alter table ... enable row level security` 가 표를 만드는 판에 함께 있고, 정책 대상에 `TO public` 을 안 쓴다. 쓰기는 서비스롤만, 읽기는 `authenticated` 만. 사본(`create table as`)을 안 만든다
- `pnpm test rls-baseline` 통과 — 가드가 새 표를 RLS 켜진 것으로 센다
- `pnpm test last-price` 통과, `pnpm tsc --noEmit` 통과
의존: 없음
보안: **표를 만든다** — 같은 마이그레이션에서 RLS 를 켜고 정책 대상에 `TO public` 을 안 쓴다. 쓰기는 서비스롤(크론)만, 읽기는 인증된 사용자만. 사본을 안 만든다

### I02 현재가를 읽는 창구를 연다
상태: 취소 (창구를 안 연다 — 기존 가드 셋이 「트레이딩 창구는 크론 둘뿐」을 지키고 있고 그 규칙이 옳다. 창구를 늘리면 지킬 자리가 는다. 대신 현황 payload 에 실어 이미 도는 새로고침으로 받는다 → I02a)
모드: 중량
범위: apps/web/app/api/trading/price/route.ts (신규), apps/web/lib/policy/api-auth-surface.test.ts, apps/web/lib/trading/bars/last-price.ts
감사 기준:
- 화면이 짧은 간격으로 부를 수 있는 읽기 창구를 연다 — 형성 중인 봉은 분보다 자주 움직여야 한다
- **인증 장치를 부른다.** `isTradingOwner()` 로 막고, 아니면 404 로 답한다 (있는지 없는지를 알려 주지 않는다, S3)
- 창구는 **표만 읽는다.** 증권사를 직접 부르지 않는다 — 화면이 부를 때마다 KIS 를 부르면 초당 한도에 걸린다(실측 `EGW00201` 이미 있었음)
- 응답에 계좌·키가 안 실린다, 가격과 시각뿐이다
- `api-auth-surface.test.ts` 가 이 창구를 인증 있는 것으로 센다
- `pnpm test api-auth` 통과, `pnpm tsc --noEmit` 통과
의존: I01
보안: **새 창구다** — 누가 부를 수 있나(소유자만), 서비스롤을 쓰면 그 위에 사람 확인이 있나(읽기 전용이고 소유자 확인이 먼저), 밖에서 온 값을 다루나(없음, 인자 없는 GET)

### I02a 현재가를 현황이 함께 내려준다
상태: 통과
모드: 경량
범위: apps/web/lib/trading/overview.ts, apps/web/lib/trading/overview-shape.ts, apps/web/lib/trading/settings/registry.ts, apps/web/lib/trading/bars/last-price.test.ts
감사 기준:
- 현황이 마지막 현재가와 **받은 시각**을 함께 내려준다 — 새 창구를 안 연다, 기존 가드 셋(`창구가 둘뿐이다`·`새 창구를 안 연다`·`모든 /api 라우트는 스스로 인증한다`)이 지키는 규칙이다
- 못 읽어도 현황이 안 죽는다 (다른 칸들과 같은 규칙)
- 다시 읽는 간격(`overview_refresh_seconds`)의 하한을 낮춰 형성 봉이 자주 움직이게 한다 — 지금 기본 30초는 분에 두 번이라 「모양이 변한다」가 안 보인다
- **얼마나 자주 부를지는 설정이다.** 코드가 박으면 무거워졌을 때 배포를 기다려야 한다
- `pnpm test last-price` 통과, `pnpm tsc --noEmit` 통과
의존: I01
보안: 해당 없음 — 새 표·창구가 없고, 이미 서버가 읽는 값을 한 줄 더 실어 보낼 뿐이다. 가격과 시각뿐이라 비밀이 섞일 자리가 없다

### I03 맨 오른쪽 봉이 형성 중인 봉이 된다
상태: 통과
모드: 경량
범위: apps/web/lib/trading/chart/forming.ts (신규), apps/web/lib/trading/chart/forming.test.ts (신규), apps/web/app/(trading)/trading/ChartPanel.tsx, apps/web/app/(trading)/trading/ChartPanel.module.css, apps/web/package.json
감사 기준:
- 확정 봉 뒤에 **형성 중인 봉 한 개**가 붙고, 새 값이 올 때마다 고가·저가·종가가 움직인다 (시가는 그 분 첫 값으로 고정)
- **확정 봉과 눈으로 구분된다** — 테두리만 있고 속이 비었다. 구분이 없으면 확정 안 된 값을 확정으로 읽는다
- 분이 바뀌면 형성 중이던 봉을 버리고 새로 시작한다 — 확정 봉은 서버가 주는 것만 쓴다
- 값이 오래되면(마지막 값이 N초 넘게 안 바뀌면) 형성 중인 봉을 **안 그린다**, 멈춘 값을 살아 있는 것처럼 그리지 않는다
- 장이 닫혀 있으면 안 그린다
- `pnpm test forming` 통과, `pnpm tsc --noEmit` 통과
의존: I02a
보안: 해당 없음 — 화면 그리기만이다

### I03a 화면에서 봉 단위를 고른다
상태: 통과
모드: 경량
범위: apps/web/lib/trading/chart/timeframe.ts (신규), apps/web/lib/trading/chart/timeframe.test.ts (신규), apps/web/lib/trading/overview.ts, apps/web/lib/trading/overview-shape.ts, apps/web/app/(trading)/trading/ChartPanel.tsx, apps/web/app/(trading)/trading/ChartPanel.module.css, apps/web/package.json
감사 기준:
- 차트 위에 봉 단위 고르기가 서고 **1·3·5·10·15·30·60분**을 고를 수 있다 (통상 HTS 가 주는 목록)
- 묶는 셈은 `bars/confirm.ts` 의 규칙을 그대로 쓴다 — 구간은 자정 눈금으로 나뉘고(09:00·09:05…) 거래소 눈금과 맞는다. 여기서 규칙을 새로 적으면 화면 봉과 저장 봉이 다른 시장을 요약하게 된다
- **표에 더 안 쌓는다.** 실어 온 1분봉을 그 자리에서 묶는다
- 마지막 구간이 덜 찼으면 그것이 곧 **형성 중인 봉**이다 — 5분봉을 고르면 5분 동안 모양이 변한다 (I03 과 같은 자리)
- 고른 값이 새로고침 뒤에도 남는다 (설정이 아니라 화면 기억, 판단 단위와 섞이면 안 된다)
- **판단 봉 단위와 다른 것임을 화면이 말한다** — 이 고르기는 보는 단위만 바꾸고, 시스템은 계속 1분으로 판단한다
- 단위를 바꿔도 창이 봉 수 상한 안에 머문다 (60분봉을 골라도 120개를 안 넘는다)
- `pnpm test timeframe` 통과, `pnpm tsc --noEmit` 통과
의존: I03
보안: 해당 없음 — 이미 실어 온 봉을 묶어 그릴 뿐이고 새 표·창구·바깥 값이 없다

### I04 형성 중인 봉이 판단에 안 들어간다
상태: 통과
모드: 경량
범위: apps/web/lib/policy/forming-bar-isolation.test.ts (신규), apps/web/package.json
감사 기준:
- 가드가 **확정 안 된 값이 지표·판단·채점에 닿지 않는 것**을 센다 — `computeIndicators`·`scoreJudgment`·`buildLineage` 에 들어가는 봉이 서버가 준 확정 봉뿐이다
- 형성 중인 봉은 그리는 자리(`ChartPanel`)에서만 만들어지고 `lib/trading/chart/` 밖으로 안 샌다
- **화면 봉 단위가 판단에 안 닿는다** — 판단은 계속 `decision_tf`(1분)로 돈다, 화면에서 60분을 골라도 판단 단위가 안 바뀐다
- 가드를 일부러 깨뜨려(형성 봉을 지표에 섞은 판) 실패를 확인하고 그 사실을 pass --notes 에 적는다
- `pnpm test` 전체 통과
의존: I03
보안: 해당 없음 — 가드 파일 하나와 등재 한 줄이다

### I05 마우스 휠로 차트를 움직인다
상태: 통과
모드: 경량
범위: apps/web/app/(trading)/trading/ChartPanel.tsx, apps/web/app/(trading)/trading/ChartPanel.module.css, apps/web/lib/trading/chart/series.ts, apps/web/lib/trading/chart/series.test.ts
감사 기준:
- 차트 위에서 휠을 굴리면 **보는 구간이 넓어지고 좁아진다** (HTS 관례: 휠이 시간축을 줌)
- 커서가 있는 자리를 기준으로 줄고 는다 — 화면 가운데만 기준으로 하면 보던 봉이 달아난다
- 창이 봉 수 상한·하한 안에 머문다 (최소 20봉 · 실어 온 봉 전부까지)
- **페이지 스크롤을 뺏는 것이 의도다** — 차트 위에서는 차트가 움직인다. 그래서 차트 **밖**에서는 그대로 페이지가 내려가는지 같이 본다
- 휠 이벤트를 프레임마다 한 번만 반영한다 (매 이벤트 다시 그리면 무거워진다, 실측 전례)
- `pnpm tsc --noEmit` 통과, `pnpm test series` 통과
의존: 없음
보안: 해당 없음 — 화면 그리기만이다

### I06 실브라우저로 본다
상태: 통과
모드: 경량
범위: apps/web/e2e/trading-chart.spec.ts
감사 기준:
- 휠을 굴리면 X축 눈금 수가 바뀐다 (줌이 실제로 먹는지)
- 차트 밖에서 굴리면 페이지가 내려간다
- 형성 중인 봉이 확정 봉과 다른 모양으로 그려진다
- **서버가 성한 상태에서 돈다** — 실측 2026-09-29: 14시간 된 개발 서버는 차트를 아예 안 그렸다. 돌리기 전에 봉이 실제로 그려지는지부터 확인한다
- 못 돌리면 그 사실을 pass --notes 에 적고 통과로 치지 않는다
의존: I03, I05
보안: 해당 없음 — 시험 파일이다

### I07 업데이트 내역을 올린다
상태: 대기
모드: 경량
범위: apps/web/lib/changelog/entries.ts
감사 기준:
- `entries.ts` 맨 위에 이번 버전 블록이 있고 사용자 말로 적힌다 (현재봉이 실시간으로 움직인다 · 휠로 차트를 볼 수 있다)
- 블록의 버전은 그때 다시 계산한 다음 패치다
- `pnpm test policy-sync`, `pnpm test version-rule` 통과
의존: I06
보안: 해당 없음 — 문서 문자열이다

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-29) 최초 작성 (ins_0147)
- v0.2.0 (2026-09-30) 사용자 지시로 화면 봉 단위 고르기를 범위에 넣음 — 1분봉을 그 자리에서 묶어 그리므로 표를 더 안 쌓고, 판단 단위와는 분리 (iv_0157)
- v0.3.0 (2026-09-30) 창구를 안 연다 — 기존 가드 셋이 트레이딩 창구를 크론 둘로 묶어 두고 있고 그 규칙이 옳다. I02 취소하고 현황 payload 에 싣는 I02a 로 바꿈 (audit:I02)
