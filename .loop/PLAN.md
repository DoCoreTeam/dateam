# PLAN newAX: 판단이 생각하다 제 시간에 안 끊기게 한다
플랜 ID: P0087
플랜 버전: v0.1.0
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
상태: 대기
모드: 경량
범위: apps/web/lib/trading/judge/jev.ts, apps/web/lib/trading/jobs/tick.ts
감사 기준:
- `JevJudgeOptions` 에 생각 깊이가 있고, `gatewayCaller` 의 fetch 본문(JSON.stringify 인자)에 그 값이 실린다 — 선언만 하고 안 넘기는 자리가 없다
- `tick.ts` 가 `str('jev_reasoning_effort', 'low')` 로 읽어 `createServerJevJudge` 에 넘긴다
- 설정을 빼고 부르면 기본 `low` 가 나간다 (값이 undefined 로 새지 않는다)
- `pnpm tsc --noEmit` 통과
의존: I01
보안: 해당 없음 — 바깥으로 나가는 값이 늘지만 관문 주소는 그대로(`openAiCompatibleBaseUrl`)고 새 창구도 새 표도 없다. 프롬프트는 안 바뀌므로 가림(마스킹) 경로도 그대로다

### I03 청산 섀도도 같은 길로 간다
상태: 대기
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

### I05 버전과 업데이트 내역을 올린다
상태: 대기
모드: 경량
범위: package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md, apps/web/lib/changelog/entries.ts
감사 기준:
- 부록 「버전 규칙」의 여섯 파일을 순서대로 올린다, 다음 버전은 `git log --oneline -5` 와 package.json 중 큰 쪽에 patch 1
- `entries.ts` 맨 위에 이번 버전 블록이 있고 사용자 말로 적힌다 (판단이 중간에 끊기던 것이 안 끊긴다)
- `pnpm test policy-sync`, `pnpm test version-rule` 통과
의존: I04
보안: 해당 없음 — 문서와 버전 문자열이다

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-28) 최초 작성 (ins_0146)
