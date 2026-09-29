# PLAN newAX: 판단이 생각하다 제 시간에 안 끊기게 한다
플랜 ID: P0087
플랜 버전: v0.3.1
상태: 진행중
지시: ins_0146
목표 버전: v0.10.689
작성: 2026-09-28
시작 커밋: 45a8c672

## 목표
- 판단기(Jev)가 관문에서 답을 받아 오는데도 우리가 먼저 끊어 버리는 일을 없앰
- 관문 실측 2026-09-28: 같은 판단 프롬프트가 19.7~21.5초 걸렸고 제한시간은 20초, 출력 3,290토큰 중 3,254개가 생각 토큰이었음
- 어제 장중 실측: 관문은 22건 전부 200 으로 답했는데 `trading_judgments` 에는 완료 17 · `timeout:20000ms` 3 · `timeout:10000ms` 2 로 남음, 다섯 중 하나를 우리가 버림
- 생각 깊이를 관리자가 정하게 해서 속도와 판단 품질의 맞바꿈을 운영자가 쥐게 함 (실측 low=9.9초 · none=1.7초 · 지금(무지정)=20.4초)
- 현황 차트를 확대해 볼 수 있고, 봉에 마우스를 올리면 그 봉의 값과 그때 난 판단이 뜸 (사용자 지시 2026-09-29)
- 「지금 예측」이 주문할 수 있는 말로 끝남 — 얼마에 들어가고, 얼마에 끊고, 얼마에 나오고, 언제까지 유효한지 (사용자 지시 2026-09-29 「내가 지금 주문을 어떻게 해야 하는지 모르겠어」)
- 차트가 오늘 장을 보여 줌 — 지금은 180봉이 어제 오후부터라 오늘 새 봉이 들어와도 화면이 안 움직이는 것으로 보임 (같은 지시 「실시간 시스템처럼 차트가 움직여야」)

## 범위 밖
- `jev_timeout_seconds` 의 상한(30초) 조정 — 생각 깊이 low 면 9.9초라 20초 안에 여유가 있음
- 증권사 조회 실패(`fills_failed:kis:kis_APAC0071`)와 안전 게이트 SG-01·02·08·12 — 판단기와 다른 줄이고 이 플랜이 건드리지 않음
- 판단 결과가 신호로 나가는 경로 — 지금은 무장이 꺼져 있고(`trading_arming` 양쪽 armed=false) 그것은 운영자의 선택임
- 청산 섀도가 한 건도 없는 것 — 포지션이 0건이라 입력 자체가 없었던 것이고 결함이 아님 (`trading_fills`·`trading_orders`·`trading_position_events` 전부 0행, 2026-09-28 실측)

## 완료 정의
- pnpm tsc --noEmit, pnpm test, pnpm build 통과
- 사용자 노출 문자열은 전부 i18n 키 사용
- 설정값은 env 추가 없이 DB 저장 + UI 관리
- 관문에 실제로 나가는 본문에 생각 깊이가 실림 (가드가 값으로 대조)
- 관리자가 고를 수 있는 값이 관문이 받는 값과 같음 (관문 실측: none|minimal|low|medium|high|xhigh|max 외에는 400)

## 참조
- 관문 응답 규격: `lib/trading/judge/jev-prompt.ts` 의 `parseJevResponse`
- 설정 등재 자리: `lib/trading/settings/registry.ts` (`TRADING_SETTINGS`), 초기값은 `seedTradingSettings` 가 심음
- 관문 실측 근거 2026-09-28
  - `reasoning_effort` 미지정 `google/gemini-2.5-flash`: 19,720 / 20,156 / 21,460ms · 생각 3,254토큰 · $0.0083/건
  - `reasoning_effort: low`: 9,912ms · 생각 930토큰 · $0.0026/건
  - `reasoning_effort: none`: 1,722ms · 생각 0토큰 · $0.00024/건
  - 생각을 안 하는 모델(`openai/gpt-4o-mini` · `alibaba/qwen3-coder`)에 low 를 실어도 200, 관문이 무시함
  - 관문이 모르는 값(`bogus`)은 400 `expected one of "none"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max"`
- 원장 대조: `ai_llm_calls` purpose=trading_judge · `google/gemini-2.5-flash` ok=true 22건 평균 21,686ms 최대 58,482ms

## 항목

### I01 생각 깊이를 설정으로 세운다
상태: 통과
모드: 경량
범위: apps/web/lib/trading/settings/registry.ts
감사 기준:
- `TRADING_SETTINGS` 에 `jev_reasoning_effort` 가 있고 group 은 `decision`, type 은 고르기이며 고를 값이 none·minimal·low·medium·high·xhigh·max 일곱 개다
- 기본값이 `low` 다 (관문 실측 9.9초, 제한시간 20초 안에 여유가 있고 생각을 아예 끄지는 않음)
- `pnpm test registry` 통과, 레지스트리 가드가 새 줄을 받아들인다
- `pnpm tsc --noEmit` 통과
의존: 없음
보안: 해당 없음 — 표·창구·바깥 값 셋 다 아니고, 레지스트리 상수 한 줄 추가다. 7절 「닿는 자리」 어디에도 안 걸린다

### I02 진입 판단이 그 값을 관문까지 들고 간다
상태: 통과
모드: 경량
범위: apps/web/lib/trading/judge/jev.ts, apps/web/lib/trading/jobs/tick.ts, apps/web/lib/trading/validation/pipeline.ts, apps/web/lib/trading/judge/jev.test.ts
감사 기준:
- `JevJudgeOptions` 에 생각 깊이가 있고, `gatewayCaller` 의 fetch 본문(JSON.stringify 인자)에 그 값이 실린다 — 선언만 하고 안 넘기는 자리가 없다
- `tick.ts` 가 `str('jev_reasoning_effort', 'low')` 로 읽어 `createServerJevJudge` 에 넘긴다
- **부르는 자리가 셋이다.** `tick.ts` 말고 `validation/pipeline.ts` 도 같은 판단기를 만든다 — 검증이 실시간과 다른 깊이로 생각하면 잰 성적이 실전의 것이 아니다(M4, 그 파일이 공급자를 맞추는 이유와 같다). 셋 다 같은 설정 키를 읽는다
- 빈 값이면 `reasoning_effort` 줄을 아예 안 싣는다 (빈 문자열은 관문이 400 으로 거절하고 그 400 이 키·모델 문제와 섞인다)
- `pnpm tsc --noEmit` 통과, `pnpm test jev` 통과
의존: I01
보안: 해당 없음 — 바깥으로 나가는 값이 늘지만 관문 주소는 그대로(`openAiCompatibleBaseUrl`)고 새 창구도 새 표도 없다. 프롬프트는 안 바뀌므로 가림(마스킹) 경로도 그대로다

### I02a 지금 예측이 주문할 수 있는 말로 끝난다
상태: 통과
모드: 경량
범위: apps/web/lib/trading/chart/series.ts, apps/web/lib/trading/overview.ts, apps/web/app/(trading)/trading/ChartPanel.tsx, apps/web/app/(trading)/trading/ChartPanel.module.css, apps/web/lib/trading/signal-labels.ts, apps/web/lib/trading/chart/series.test.ts
감사 기준:
- 판단에서 온 답에도 진입가·손절가·목표가·진입 한계가가 뜬다. 지금은 `call.from === 'signal'` 일 때만 그려서, 신호가 0건인 지금 화면에는 숫자가 하나도 없다 (사용자 실측 2026-09-29 화면)
- 값은 `judge/exit-plan-math.ts` 의 `buildExitPlan` 이 만든다 — 화면이 식을 따로 적으면 백테스트가 재는 전략과 화면이 말하는 전략이 갈린다(M4). ATR 은 `judge/indicators.ts` 의 `computeIndicators` 로 같은 봉에서 구한다
- 지표를 못 구하면(봉이 `requiredBarCount` 보다 적으면) 계획 자리를 비우고 왜 없는지 말한다 — 0 이나 기준가로 채우지 않는다 (「손절 없음」과 「손절 모름」이 화면에서 같아지면 안 된다)
- **이 값은 예고지 지시가 아니다.** 계획 옆에 「아직 신호로는 안 나갔습니다」와 막힌 단계가 그대로 선다, 무장이 꺼져 있다는 사실도 같이 읽힌다
- 언제까지가 둘이다 — 들어갈 수 있는 동안(`signal_valid_minutes`)과 들어간 뒤 들고 있는 동안(`min_hold_minutes` 시간 청산 · 당일 청산 시각). 둘을 한 글자로 뭉치지 않는다
- 새 문자열은 `lib/trading/signal-labels.ts` 쪽 말 SSOT 에 두고 화면이 직접 안 적는다
- `pnpm tsc --noEmit` 통과, `pnpm test series` 통과
의존: 없음
보안: 해당 없음 — 이미 읽고 있는 봉과 설정으로 셈만 더한다, 새 표·새 창구·바깥에서 오는 값이 없다

### I02b 차트가 오늘을 보여 주고 구간을 잡아 어제까지 넓힌다
상태: 통과
모드: 경량
범위: apps/web/lib/trading/chart/series.ts, apps/web/lib/trading/overview.ts, apps/web/app/(trading)/trading/ChartPanel.tsx, apps/web/app/(trading)/trading/ChartPanel.module.css, apps/web/lib/trading/chart/series.test.ts
감사 기준:
- 기본으로 그리는 구간이 **오늘 봉**이다. 지금은 `CHART_BARS = 180` 이 날을 안 가려서 어제 12:47~15:34 뒤에 오늘 09:03 이 붙고, 오늘 봉 넷이 180 중 넷이라 새 봉이 들어와도 화면이 안 움직인다 (사용자 실측 2026-09-29 화면의 X축)
- 오늘 봉이 지표를 구할 만큼(`requiredBarCount`) 안 모였으면 어제까지 거슬러 채운다 — 빈 차트를 안 그린다는 이 파일의 기존 규칙과 같은 이유
- 날이 둘 이상 섞이면 그 경계에 선과 날짜가 선다 — 경계 없이 이으면 밤새 가격이 안 움직인 것으로 읽힌다
- 차트 아래 구간 선택 띠(recharts `Brush`)로 어제까지 넓힐 수 있고 되돌릴 길이 있다 — 되돌릴 방법이 없는 창은 갇히는 것이다
- 봉이 0건이면 띠를 안 그린다, 띠에 판단·신호 표식과 같은 색을 쓰지 않는다
- `pnpm tsc --noEmit` 통과, `pnpm test series` 통과, `pnpm test css-defined` 통과
의존: 없음
보안: 해당 없음 — 읽는 봉 수와 그리는 자리만 바뀐다, 새 표·창구·바깥 값이 없다

### I03 청산 섀도도 같은 길로 간다
상태: 통과
모드: 경량
범위: apps/web/lib/trading/judge/exit-jev.ts, apps/web/lib/trading/jobs/knowledge-job.ts, apps/web/lib/trading/jobs/tick.ts
감사 기준:
- `ExitJudgeInput` 에 생각 깊이가 있고 `exit-jev.ts` 의 fetch 본문에 실린다
- `knowledge-job.ts` 의 position 묶음이 그 값을 받아 `judgeExitShadow` 에 넘긴다
- `tick.ts` 가 진입 판단과 **같은 설정 키**를 읽어 양쪽에 넣는다 — 두 곳이 다른 값을 쓰면 섀도 성적이 진입과 견줄 수 없게 된다 (§17.1 같은 키·같은 예산·같은 원장)
- `pnpm tsc --noEmit` 통과
의존: I02
보안: 해당 없음 — I02 와 같은 이유. 표는 `trading_exit_judgments` 하나뿐이고 그 표에 새 칼럼을 안 만든다

### I04 값이 관문 본문까지 가는지 가드가 센다
상태: 대기
모드: 경량
범위: apps/web/lib/policy/jev-reasoning-effort.test.ts (신규), apps/web/package.json
감사 기준:
- 가드가 `jev.ts`·`exit-jev.ts` 의 fetch 본문에서 생각 깊이 **값이 넘어가는지**를 본다, 이름이 파일에 있는지가 아니라 (실측 교훈: 선언만 하고 안 넘기는 결함이 네 번 났음)
- 가드가 레지스트리의 고를 값 일곱 개와 관문이 받는 일곱 개가 같은지 대조한다
- 가드를 일부러 깨뜨려(값 인자만 지우고 선언은 남긴 판) 실패하는 것을 확인하고 그 사실을 pass --notes 에 적는다
- `apps/web/package.json` 의 test 스크립트에 등재하고, 등재 뒤 총 테스트 수가 실제로 늘었는지 확인한다
- `pnpm test` 통과
의존: I03
보안: 해당 없음 — 가드 파일 하나와 등재 한 줄이다

### I04a 차트에서 구간을 잡아 확대하고 되돌린다
상태: 취소 (I02b 로 합침 — 확대와 「오늘이 기본」은 같은 파일 같은 판이고, 확대 없이 창만 좁히면 어제를 볼 길이 사라진다)
모드: 경량
범위: apps/web/app/(trading)/trading/ChartPanel.tsx, apps/web/app/(trading)/trading/ChartPanel.module.css
감사 기준:
- 차트 아래에 구간 선택 띠가 서고, 띠를 좁히면 위 차트가 그 구간만 그린다 (recharts `Brush`)
- 확대한 뒤 되돌리는 길이 있다 — 되돌릴 방법이 없는 확대는 갇히는 것이다
- 봉이 0건이면 띠를 안 그린다 (빈 차트를 「값이 0」으로 읽히게 하지 않는다는 이 파일의 기존 규칙과 같은 이유)
- 띠에도 판단 표식과 같은 색을 쓰지 않는다 — 신호·판단 표식과 구간 띠가 같은 무게로 읽히면 안 된다
- `pnpm tsc --noEmit` 통과, `pnpm test css-defined` 통과 (새 클래스가 CSS 에 실제로 있는지)
의존: 없음
보안: 해당 없음 — 화면 그리기만이고 새 표·창구·바깥 값이 없다

### I04b 확대와 호버가 실제로 되는지 실브라우저로 본다
상태: 대기
모드: 경량
범위: apps/web/e2e/trading-chart.spec.ts (신규), apps/web/package.json
감사 기준:
- 봉 위에 마우스를 올리면 시가·고가·저가·종가가 뜬다 — 지금 배선(`R.Tooltip content={<BarTip/>}`)이 화면에서 실제로 도는지 확인한다, 코드에 있는 것과 뜨는 것은 다르다
- 도움말에 `band : 1092.28,1093.3` 같은 기계 이름이 안 뜬다
- 구간 띠를 끌면 X축 눈금이 줄어든다 (확대가 실제로 먹는지)
- 격리 서버로 돈다 (`NEXT_DIST_DIR` + `:3100` + `E2E_BASE_URL`), 공유 :3000 을 쓰지 않는다 — 공유 판이 28판 뒤를 물어 헛짚은 전례가 있다
- 날이 바뀌는 자리에 경계가 서는지 본다 (봉 구간에 어제와 오늘이 같이 있을 때)
- 「지금 예측」에 진입·손절·목표·유효시간이 실제로 떠 있는지 본다 — 신호 0건인 판에서도 (I02a)
- 패치노트 백드롭이 클릭을 삼키는지 먼저 확인하고 떠 있으면 닫고 시작한다
의존: I02a, I02b
보안: 해당 없음 — 시험 파일과 등재 한 줄이다

### I05 업데이트 내역을 올린다
상태: 대기
모드: 경량
범위: apps/web/lib/changelog/entries.ts
감사 기준:
- `entries.ts` 맨 위에 이번 버전 블록이 있고 사용자 말로 적힌다 (판단이 중간에 끊기던 것이 안 끊긴다 · 지금 예측이 얼마에 들어가고 얼마에 나오는지까지 말한다 · 차트가 오늘 장을 보여 주고 어제까지 넓혀 볼 수 있다)
- 버전 파일 다섯(package.json 둘 · CEO.md · AGENTS.md · GEMINI.md)은 `loop pass` 가 항목 커밋마다 이미 올리므로 여기서 손대지 않는다, 여섯째만 남은 것이다
- 블록의 버전은 **그때 다시 계산한 다음 패치**다, 플랜을 세울 때 잡은 목표값이 아니다
- `pnpm test policy-sync`, `pnpm test version-rule` 통과
의존: I04b
보안: 해당 없음 — 문서 문자열이다

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-28) 최초 작성 (ins_0146)
- v0.2.0 (2026-09-28) 사용자 지시로 현황 차트 확대와 호버 상세 확인을 범위에 더함 (I04a·I04b), I05 는 버전 파일 다섯을 CLI 가 이미 올리므로 changelog 한 파일로 좁힘 (ins_0147)
- v0.2.1 (2026-09-28) I02 구현 중 세 번째 호출 자리 발견 — validation/pipeline.ts 도 createServerJevJudge 를 부른다, 검증이 실시간과 다른 깊이로 생각하면 성적이 실전의 것이 아니므로 범위에 넣음 (audit:I02)
- v0.3.0 (2026-09-29) 사용자 지시로 주문 계획 표시(I02a)와 오늘 장 중심 차트(I02b)를 범위에 넣음, 확대만 다루던 I04a 는 I02b 에 합쳐 취소 (iv_0135)
- v0.3.1 (2026-09-29) I02a 범위에 ChartPanel.module.css 와 signal-labels.ts 를 더함 — 감사 기준이 「새 문자열은 말 SSOT 에 둔다」를 요구하는데 그 파일이 범위에 없었다 (audit:I02a)
