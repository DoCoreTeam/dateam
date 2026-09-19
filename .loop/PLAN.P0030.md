# PLAN newAX: AI 호출을 무료 등급 안으로
플랜 ID: P0030
플랜 버전: v0.1.1
상태: 진행중
지시: iv_0069
목표 버전: v0.10.189
작성: 2026-09-20
시작 커밋: 590a62dd

## 목표
- 하루 AI 호출을 23,318건에서 **40건 이하**로 (실측 신규 콘텐츠가 하루 7.3건뿐)
- **같은 질문을 두 번 하지 않는다** — 발견이 물을 수 있는 질문은 떡상 624개가 전부인데 사흘에 49,064번 물었다
- **자동으로 도는 AI 를 없앤다** — 해석은 사람이 누를 때, 신규분 처리는 하루 1회 예약
- 호출 한 건의 입력을 770토큰에서 400토큰 아래로, 출력은 능력별 상한으로
- **셈하는 자리 하나**가 남은 횟수를 알고 거절한다 (지금은 상한을 아는 자리가 0곳)
- 구현 단계는 Claude 로, 운영만 설정된 공급자로

## 범위 밖
- CI 의 분석 품질과 승격 규칙 (표본 30건은 실측으로 정해진 값이라 건드리지 않는다)
- 유료 전환 여부 결정
- 벤더 호출 세 길(gemini-call, guarded-gemini, ai-gateway)을 **하나로 합치는 일** — 이번에는 셋이 같은 창구를 지나게만 한다
- RFP·CRM·회의노트의 프롬프트 내용 변경
- 새 AI 기능 추가

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 콘텐츠 1건 인입이 발견 배치를 부르지 않음 (가드)
- 같은 대조쌍을 두 번 물으면 두 번째는 벤더에 안 나감 (가드)
- 자동으로 AI 를 부르는 단계가 전부 「이미 봤음」을 거름 (가드)
- 하루 상한에 닿으면 호출이 거절되고 사유와 풀리는 시각이 응답에 있음 (가드)
- 관리자 사용량 화면이 ai_llm_calls 를 읽음 (가드)
- 개발 판에서 운영 공급자 키를 쓰지 않음 (가드)
- 실브라우저에서 확인: 트렌드 화면이 「새로 물을 것 N건」을 보이고, 0건이면 버튼이 안 눌림
- 적용 하루 뒤 원장 실측으로 하루 호출 40건 이하 확인

## 참조
- 기획 보고: https://claude.ai/code/artifact/68a57811-5ea0-4dcd-bf40-780cb931b00c
- 실측 2026-09-20: ai_llm_calls 3일 50,243건 중 47,055건 실패, ci-discover 가 97.6%
- 실측: ci_contents 1,841건, 떡상(outlier_index>=2) 624건, 신규 하루 7.3건(14일 평균)
- 실측: ci_jobs project 단계 STALLED 302건, 전부 시도 3회 뒤 폐기
- lib/ci/jobs/handlers.ts:296 handleProject 가 runDiscovery 를 인자 없이 부름
- lib/ci/analysis/discovery.ts MIN_CALL_INTERVAL_MS=3200, DEFAULT_MAX_SETS=30
- lib/ci/jobs/drain-policy.ts STALE_LOCK_MS=5분
- 이미 있는 버튼: TrendsView.tsx:588 → /api/ci/patterns/recompute (topicId 선택 가능)
- 이미 신규만 거르는 선례: runCreativeBacklog(ci_content_creative 대조), runMediaBacklog

## 항목

### I01 발견과 공식을 단건 처리에서 뗀다
상태: 통과
모드: 경량
범위: apps/web/lib/ci/jobs/handlers.ts, apps/web/lib/ci/jobs/stages.ts, apps/web/lib/ci/analysis/discovery.ts, apps/web/lib/ci/jobs/trigger-scope.test.ts (신규), apps/web/app/api/ci/patterns/recompute/route.ts, apps/web/app/api/ci/internal/worker/discover/route.ts, apps/web/package.json
감사 기준:
- handleProject 가 runDiscovery 와 runPatterns 를 부르지 않음 (가드 1개, 소스 대조)
- runDiscovery 가 maxSetsPerTopic 없이 불리면 던짐, 호출부는 예산을 반드시 준다 (단위 테스트)
- /api/ci/patterns/recompute 와 /api/ci/internal/worker/discover 는 그대로 동작 (기존 가드 통과)
- pnpm --filter web exec node --test lib/ci/jobs/trigger-scope.test.ts 통과, 등재 후 총 테스트 수 증가
의존: 없음

### I02 한도를 한도라고 부른다
상태: 대기
모드: 경량
범위: apps/web/lib/ai/gemini-call.ts, apps/web/lib/ai/gemini-call.test.ts, apps/web/lib/ci/ai/discover-server.ts
감사 기준:
- Gemini 냉각으로 사슬을 건너뛴 뒤 폴백까지 실패하면 reason 이 'server' 가 아니라 'quota' (단위 테스트)
- 사용자 문구가 「잠시 후 다시」가 아니라 한도 안내로 나감 (단위 테스트)
- discover 루프의 멈춤 판정이 문자열 대조가 아니라 GeminiCallError.reason 을 봄 (가드 1개)
- 한도로 멈추면 남은 대조쌍을 더 부르지 않음 (단위 테스트, 호출 횟수 단정)
의존: 없음

### I03 긴 작업이 자기 잠금을 갱신한다
상태: 대기
모드: 경량
범위: apps/web/lib/ci/jobs/queue.ts, apps/web/lib/ci/jobs/drain.ts, apps/web/lib/ci/jobs/drain-policy.ts, apps/web/lib/ci/jobs/drain-policy.test.ts
감사 기준:
- 잠금 갱신 함수가 있고, 5분을 넘기는 단계가 도는 동안 locked_at 을 갱신함
- 갱신이 실패해도 작업을 멈추지 않음 (기록만 남김)
- 좀비 판정은 그대로 5분, 갱신이 없으면 기존 동작과 같음 (단위 테스트)
- 기존 drain-policy 가드가 그대로 통과
의존: I01

### I04 대조쌍 지문과 답 저장 자리
상태: 대기
모드: 경량
범위: supabase/migrations/NNN_ci_discovery_answers.sql (신규), apps/web/lib/ci/analysis/contrast-key.ts (신규), apps/web/lib/ci/analysis/contrast-key.test.ts (신규), apps/web/package.json
감사 기준:
- 지문이 순수 함수로, 떡상 id 와 대조 3건 id(정렬)와 프롬프트 판 번호만으로 만들어짐
- **배수는 지문에 안 들어감** — 형제가 늘면 배수가 흔들려 절감이 사라진다, 대신 떡상 자격이 바뀌면 대조쌍 자체가 달라져 지문이 달라짐 (단위 테스트로 두 경우 확인)
- 같은 입력에 항상 같은 지문, 순서가 달라도 같은 지문 (단위 테스트)
- 표에 지문 유니크 제약이 있고 답과 프롬프트 판 번호를 함께 담음
- 마이그레이션이 운영에 적용되고 --status 로 확인됨
의존: 없음

### I05 발견이 저장된 답을 쓴다
상태: 대기
모드: 경량
범위: apps/web/lib/ci/ai/discover-server.ts, apps/web/lib/ci/ai/discover-server.test.ts (신규), apps/web/package.json
감사 기준:
- 저장된 지문이면 벤더를 안 부르고 저장된 답을 씀 (단위 테스트, 호출 횟수 0 단정)
- 저장된 답이 없는 대조쌍만 부름, 그 수를 결과에 담아 화면이 「새로 물을 것 N건」을 말할 수 있음
- 프롬프트 판 번호가 오르면 지문이 달라져 다시 물음 (단위 테스트)
- 벤더가 답한 결과는 저장되고, 저장 실패가 사용자의 일을 막지 않음
의존: I04

### I06 자동으로 부르는 AI 는 전부 신규만 거른다
상태: 대기
모드: 경량
범위: apps/web/lib/ci/jobs/new-only.test.ts (신규), apps/web/lib/ci/jobs/stages.ts, apps/web/package.json
감사 기준:
- 자동 실행되는 AI 단계 목록이 한 곳에 있고, 각 단계가 「이미 봤음」 거르기와 회당 상한을 갖는지 가드가 소스로 확인
- 목록에 없는 새 자동 단계가 생기면 가드가 실패 (등재부 방식, 일부러 하나 빼서 실패 확인)
- 기존 runCreativeBacklog·runMediaBacklog·enrichChannelMetaBacklog 가 그대로 통과
의존: I05

### I07 하루 상한을 아는 자리
상태: 대기
모드: 중량
범위: supabase/migrations/NNN_ai_call_budget.sql (신규), apps/web/lib/ai/budget.ts (신규), apps/web/lib/ai/budget.test.ts (신규), apps/web/package.json
감사 기준:
- 기능별 하루 상한과 분당 상한을 DB 에 저장, env 추가 없음
- 남은 횟수 계산이 순수 함수, 원장(ai_llm_calls)을 세어 판단
- 상한에 닿으면 거절 사유와 풀리는 시각을 함께 돌려줌 (단위 테스트)
- 상한을 못 읽으면 **거절하지 않고 통과** — 셈이 안 된다고 사용자의 일을 막지 않는다 (단위 테스트)
- 마이그레이션 적용과 --status 확인
의존: 없음

### I08 벤더를 부르는 세 길이 그 자리를 지난다
상태: 대기
모드: 경량
범위: apps/web/lib/ai/guarded-call.ts, apps/web/lib/ai/gemini-call.ts, apps/web/lib/rfp/ai/gateway.ts, apps/web/lib/policy/ai-budget-gate.test.ts (신규), apps/web/package.json
감사 기준:
- 세 길이 전부 예산 확인을 지남 (가드 1개, 소스 대조 등재부)
- 거절된 호출도 원장에 남되 벤더로는 안 나감 (단위 테스트)
- 호출에 주인(사람 id 또는 배경 작업 이름)이 붙음, 배경이면 그 이름이 남음
- 기존 가드(pii-gateway-guard 등)가 그대로 통과
의존: I07

### I09 관리자 사용량 화면이 원장을 읽는다
상태: 대기
모드: 경량
범위: apps/web/app/admin/ai-usage/page.tsx, apps/web/app/admin/ai-usage/AiUsageDashboard.tsx, apps/web/lib/ai/usage-query.ts (신규), apps/web/lib/ai/usage-query.test.ts (신규), apps/web/package.json
감사 기준:
- 화면이 ai_llm_calls 를 읽음, ai_token_logs 를 읽지 않음 (가드 1개)
- 오늘 호출·남은 횟수·저장된 답으로 해결·거절·토큰이 보임
- 기능별 하루 상한 막대가 보이고 관리자가 상한을 바꿀 수 있음
- 화면 문자열은 @/lib/terms 를 지남 (기존 가드)
- 실브라우저에서 숫자가 psql 집계와 일치하는지 1회 대조 (스크린샷 근거)
의존: I08

### I10 능력별 등급과 사슬 순서
상태: 대기
모드: 경량
범위: apps/web/lib/ai/gemini-model.ts, apps/web/lib/ai/model-tier.ts (신규), apps/web/lib/ai/model-tier.test.ts (신규), apps/web/package.json
감사 기준:
- 능력 8종마다 기본 등급이 정해져 있고 표가 한 곳에 있음
- 사슬 순서가 **하루 한도가 큰 것부터** (단위 테스트로 순서 단정)
- Gemma 등급이 묶기·이름표 능력에서 후보가 됨, 산문 응답은 json-recover 가 받음 (단위 테스트)
- Gemma 는 짧은 입력 능력에만 열림, 긴 입력 능력에서는 후보에서 빠짐 (단위 테스트)
- 설정 모델이 여전히 1순위 (기존 동작 보존, 기존 gemini-model 가드 통과)
의존: I07

### I11 생각 예산과 출력 상한
상태: 대기
모드: 경량
범위: apps/web/lib/ai/gemini-call.ts, apps/web/lib/ai/guarded-gemini.ts, apps/web/lib/ai/output-limit.ts (신규), apps/web/lib/ai/output-limit.test.ts (신규), apps/web/package.json
감사 기준:
- 생각 예산 0 이 기본이고, 켜는 능력이 명시된 목록에만 있음 (가드 1개)
- 출력 상한이 능력별 값에서 오고 기본 32,768 이 아님
- 상한에서 잘리면 잘렸다고 말함 (기존 동작 보존)
- 기존 daily/flow-reason 의 300토큰·생각 0 설정이 그대로 유지됨
의존: I10

### I12 발견 프롬프트를 줄인다
상태: 대기
모드: 경량
범위: apps/web/lib/ci/ai/discover-server.ts, apps/web/lib/ci/ai/discover-server.test.ts
감사 기준:
- 설명 원문이 400자에서 120자로, 프롬프트 판 번호가 오름 (I04 지문이 따라 달라짐)
- 같은 대조쌍의 프롬프트 글자 수가 줄었음을 단위 테스트가 수치로 확인
- **표본 수(주제당 30건)는 그대로** — 줄이면 승격 0건이 된 실측이 있다
- 잘림(MAX_TOKENS) 이 나던 출력 상한 400 을 재검토해 잘림이 안 나는 값으로
의존: I05, I11

### I13 임베딩을 묶어서 부른다
상태: 대기
모드: 경량
범위: apps/web/lib/gemini-embedding.ts, apps/web/lib/gemini-embedding.test.ts (신규), apps/web/lib/rfp/index/embed.ts, apps/web/package.json
감사 기준:
- 묶음 창구(batchEmbedContents)로 한 요청에 여러 건을 보냄, 한 건씩 보내지 않음 (가드 1개)
- 묶음 안 한 건이 실패해도 나머지가 살아남음 (단위 테스트)
- 결과 순서가 입력 순서와 같음 (단위 테스트)
- 저장되는 차원과 모델 이름이 그대로 (기존 chunk 가드 통과)
의존: 없음

### I14 키를 고르는 자리 하나와 판 구분
상태: 대기
모드: 중량
범위: apps/web/lib/ai/provider-key-source.ts (신규), apps/web/lib/ai/provider-key-source.test.ts (신규), apps/web/lib/policy/ai-key-source.test.ts (신규), apps/web/package.json
감사 기준:
- 공급자 키를 읽는 자리가 하나이고, META 를 직접 읽는 다른 길은 가드가 막음 (일부러 한 곳 되돌려 실패 확인)
- 그 자리가 판(운영·개발·시험)을 보고 키를 고름
- 개발 판에서 운영 공급자 키가 안 쓰임 (단위 테스트)
- 키가 없으면 AI 를 부르지 않고 고정 응답, 조용히 운영 키로 새지 않음 (단위 테스트)
- 원장에 판 구분이 남음
의존: I08

### I15 구현판은 Claude, 자동 구동기는 운영만
상태: 대기
모드: 경량
범위: apps/web/components/ci/QueueDriver.tsx, apps/web/scripts/changelog-gen.mjs, apps/web/lib/ai/provider-key-source.ts, apps/web/lib/policy/ai-key-source.test.ts
감사 기준:
- 개발 판에서 QueueDriver 가 자동으로 안 돎, 버튼을 눌러야 돎 (가드 1개)
- changelog-gen 이 판에 맞는 키를 씀, 사라진 기본 모델(gemini-2.0-flash)을 안 씀
- 운영에서는 기존 동작 그대로 (가드)
- 실브라우저에서 /ci 화면을 열어 두어도 개발 판에서는 호출이 안 나감 (원장 0건 확인)
의존: I14

## 개입 기록
- iv_0069 최초 지시 (토큰 최소화, 모델 자동 조절, 무료 등급 안에서)
- iv_0070 범위 좁힘 (CI 추리기, 이전 것 빼고 신규만, 버튼 방식, 토큰 극단 축소)
- iv_0071 승인

## 갱신 이력
- v0.1.0 (2026-09-20) 최초 작성 (iv_0069)

## 변경 이력
- v0.1.1 (2026-09-19) runDiscovery 예산 인자를 필수로 만들면 호출부 두 곳이 컴파일 오류가 난다, I01 범위에 그 둘을 넣는다 (audit:I01)
