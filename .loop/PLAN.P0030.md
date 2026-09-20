# PLAN newAX: AI 호출을 무료 등급 안으로
플랜 ID: P0030
플랜 버전: v0.1.10
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
상태: 통과
모드: 경량
범위: apps/web/lib/ai/gemini-call.ts, apps/web/lib/ai/gemini-call.test.ts, apps/web/lib/ai/fallback-text.ts, apps/web/lib/ai/fallback-text.test.ts, apps/web/lib/ci/ai/discover-server.ts
감사 기준:
- Gemini 냉각으로 사슬을 건너뛴 뒤 폴백까지 실패하면 reason 이 'server' 가 아니라 'quota' (단위 테스트)
- 사용자 문구가 「잠시 후 다시」가 아니라 한도 안내로 나감 (단위 테스트)
- discover 루프의 멈춤 판정이 문자열 대조가 아니라 GeminiCallError.reason 을 봄 (가드 1개)
- 한도로 멈추면 남은 대조쌍을 더 부르지 않음 (단위 테스트, 호출 횟수 단정)
의존: 없음

### I03 긴 작업이 자기 잠금을 갱신한다
상태: 통과
모드: 경량
범위: apps/web/lib/ci/jobs/queue.ts, apps/web/lib/ci/jobs/drain.ts, apps/web/lib/ci/jobs/drain-policy.ts, apps/web/lib/ci/jobs/drain-policy.test.ts, apps/web/lib/ci/jobs/heartbeat.test.ts (신규), apps/web/package.json
감사 기준:
- 잠금 갱신 함수가 있고, 5분을 넘기는 단계가 도는 동안 locked_at 을 갱신함
- 갱신이 실패해도 작업을 멈추지 않음 (기록만 남김)
- 좀비 판정은 그대로 5분, 갱신이 없으면 기존 동작과 같음 (단위 테스트)
- 기존 drain-policy 가드가 그대로 통과
의존: I01

### I04 대조쌍 지문과 답 저장 자리
상태: 통과
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
상태: 통과
모드: 경량
범위: apps/web/lib/ci/ai/discover-server.ts, apps/web/lib/ci/ai/discovery-answers.ts (신규), apps/web/lib/ci/ai/discover-server.test.ts (신규), apps/web/lib/ci/jobs/stages.ts, apps/web/package.json
감사 기준:
- 저장된 지문이면 벤더를 안 부르고 저장된 답을 씀 (단위 테스트, 호출 횟수 0 단정)
- 저장된 답이 없는 대조쌍만 부름, 그 수를 결과에 담아 화면이 「새로 물을 것 N건」을 말할 수 있음
- 프롬프트 판 번호가 오르면 지문이 달라져 다시 물음 (단위 테스트)
- 벤더가 답한 결과는 저장되고, 저장 실패가 사용자의 일을 막지 않음
의존: I04

### I06 자동으로 부르는 AI 는 전부 신규만 거른다
상태: 통과
모드: 경량
범위: apps/web/lib/ci/jobs/auto-ai-stages.ts (신규), apps/web/lib/ci/jobs/new-only.test.ts (신규), apps/web/package.json
감사 기준:
- 자동 실행되는 AI 단계 목록이 한 곳에 있고, 각 단계가 「이미 봤음」 거르기와 회당 상한을 갖는지 가드가 소스로 확인
- 목록에 없는 새 자동 단계가 생기면 가드가 실패 (등재부 방식, 일부러 하나 빼서 실패 확인)
- 기존 runCreativeBacklog·runMediaBacklog·enrichChannelMetaBacklog 가 그대로 통과
의존: I05

### I07 하루 상한을 아는 자리
상태: 통과
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
상태: 통과
모드: 경량
범위: apps/web/lib/ai/guarded-call.ts, apps/web/lib/ai/budget.ts, apps/web/lib/ai/budget-gate.ts (신규), apps/web/lib/rfp/ai/gateway.ts, apps/web/lib/policy/ai-budget-gate.test.ts (신규), apps/web/package.json
범위 메모: 세는 자리(budget-gate.ts)를 규칙(budget.ts)에서 떼어 새로 두었고, 거절 예외를 규칙 쪽으로 옮겼다 — 세는 쪽이 서비스롤을 쓰느라 server-only 를 달고 있어서 던지기만 하려는 RFP 관문까지 서버 묶음에 묶였고 단위 시험 여덟 개가 죽었다. gemini-call.ts 는 고치지 않았다, 이미 beginGuardedCall 을 지나므로 그 자리에 예산을 얹은 것으로 같은 길이 덮인다
감사 기준:
- 세 길이 전부 예산 확인을 지남 (가드 1개, 소스 대조 등재부)
- 거절된 호출도 원장에 남되 벤더로는 안 나감 (단위 테스트)
- 상한을 못 읽으면 막지 않고 통과 (단위 테스트)
- 기존 가드(pii-gateway-guard 등)가 그대로 통과
의존: I07

### I08a 주인을 적을 자리와 등재부
상태: 통과
모드: 경량
범위: apps/web/lib/ai/actor.ts (신규), apps/web/lib/ai/gemini-call.ts, apps/web/lib/policy/ai-actor.test.ts (신규), apps/web/package.json
감사 기준:
- 벤더로 나가는 파일 전부가 등재부에 있음, 새 자리를 만들면 가드가 실패 (일부러 하나 빼서 확인)
- 배경 작업은 사람이 없다는 사유가 등재부에 적혀 있고 그 이름이 surface 문자열로 남음
- gemini-call 이 actorId 를 받아 원장까지 넘김 (단위 테스트)
- 아직 주인을 안 이어 붙인 사람 창구 수가 기준선보다 안 늘어남
의존: I08
범위 메모: 원래 한 항목이었는데 이어 붙일 창구가 열 곳이 넘어 한 번의 자가감사로 판정할 수 없었다. 자리와 등재부(I08a), 사람 창구 결선(I08b), 나머지 결선(I08c)로 나눔. guarded-call.ts 는 이미 ctx.actorId 를 원장에 그대로 적고 있어 고칠 것이 없으므로 범위에서 뺌

### I08b 사람이 누른 창구에 주인을 잇는다
상태: 통과
모드: 경량
범위: apps/web/app/api/admin/system-log/remedy/route.ts, apps/web/app/api/meeting-notes/[id]/transcript/speakers/route.ts, apps/web/lib/gemini-meeting.ts, apps/web/lib/meeting/digest-run.ts, apps/web/lib/ai/actor.ts
감사 기준:
- 네 창구가 전부 자기가 이미 쥐고 있는 사용자 id 를 actorId 로 넘김
- 등재부에서 이 넷의 «아직 안 이어 붙임» 표시가 빠지고 기준선이 10 에서 6 으로 내려감
- 회의 요약과 회의 정리는 부르는 쪽에서 userId 를 받아 그대로 내려보냄 (단위 테스트로 대조)
의존: I08a
범위 메모: daily-prompt-governance.ts 는 자기 인자에 사용자가 없어 부르는 라우트까지 고쳐야 해서 I08c 로 옮김. 등재부(actor.ts)는 기준선을 내려야 하므로 범위에 넣음

### I08c 자가조정에 주인을 잇는다
상태: 통과
모드: 경량
범위: apps/web/lib/daily-prompt-governance.ts, apps/web/app/api/ai/analyze-work/route.ts, apps/web/lib/ai/actor.ts, apps/web/lib/policy/ai-actor.test.ts, apps/web/lib/gemini-lead.ts, apps/web/lib/gemini-refine.ts
감사 기준:
- 프롬프트 자가조정이 그 사람의 일일업무에서 출발했음을 actor_id 로 남김 (라우트가 이미 쥔 user.id 를 내려보냄)
- 기준선이 6 에서 5 로 내려감
- 사용자 원문 표본을 다루는 자리이므로 가림 한 겹을 그대로 지남 (기존 guardedGeminiText 유지 확인)
- 가드가 파일 아무 데나 있는 actorId 가 아니라 **벤더를 부르는 자리 안**을 봄 (일부러 넘기는 줄만 빼서 확인)
- 고친 가드가 찾아낸 기존 누락 둘을 그 자리에서 메움 (gemini-lead 도우미, gemini-refine 옛 길)
의존: I08b
범위 메모: AI 채팅은 호출부가 열한 곳이라 같은 항목에 못 넣고 I08e 로 뺌. 가드를 범위에 넣은 이유는 아래 감사에서 드러난 결함 때문임 — 파일 전체 문자열 검색이라 인자로 선언만 하고 안 넘겨도 통과했다

### I08e AI 채팅이 주인을 반드시 받는다
상태: 대기
모드: 경량
범위: apps/web/lib/ai-chat/provider.ts, apps/web/lib/ai-chat/providers/gemini.ts, apps/web/lib/ai/actor.ts
감사 기준:
- StreamChatParams 의 actorId 가 선택이 아니라 필수라서 안 주면 형 검사가 실패함 (일부러 하나 빼서 확인)
- gemini 공급자가 받은 주인을 관문 ctx 까지 넘김
- 기준선이 5 에서 4 로 내려감
의존: I08c
범위 메모: 필수로 만들면 호출부 열한 곳이 전부 형 검사에서 걸린다, 그 결선은 I08f 에서 한다

### I08f 채팅 호출부 열한 곳이 주인을 넘긴다
상태: 대기
모드: 경량
범위: apps/web/app/api/admin/ai-chat/stream/route.ts, apps/web/app/(ai)/ai/actions.ts, apps/web/app/(ai)/ai/analyze/actions.ts, apps/web/app/(ai)/ai/analyze/template-actions.ts, apps/web/lib/ai-chat/analyze-core.ts, apps/web/lib/ai-chat/analyze-gemini.ts, apps/web/lib/ai-chat/analyze-runner-worker.ts, apps/web/lib/crm/ai/adapters/host.ts, apps/web/lib/rfp/ai/host-caller.ts
감사 기준:
- pnpm tsc --noEmit 가 통과함 (필수 칸이므로 한 곳이라도 빠지면 실패)
- 사람이 누르는 호출부는 자기가 쥔 사용자 id 를, 배경 호출부는 null 과 사유를 넘김
- 실측으로 확인: AI 채팅 한 번을 실제로 돌려 ai_llm_calls 의 그 줄 actor_id 가 친 사람 id 와 같음
의존: I08e

### I08d 남은 창구에 주인을 잇는다
상태: 대기
모드: 경량
범위: apps/web/lib/crm/ai/runner.ts, apps/web/lib/stt/provider.ts, apps/web/lib/meeting/transcribe-parts.ts, apps/web/lib/gpu/extract-helpers.ts, apps/web/lib/ai/actor.ts
감사 기준:
- 네 창구가 부르는 쪽에서 사용자 id 를 받아 actorId 로 넘김
- 등재부의 «아직 안 이어 붙임» 이 0 이 되고 기준선도 0
- ci 배치와 gpu 회사 보강은 배경으로 남고 그 사유가 등재부에 적혀 있음
의존: I08c

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
- v0.1.2 (2026-09-19) 폴백 공급자 실패도 이유를 구조로 돌려줘야 문자열 대조를 없앨 수 있다, I02 범위에 fallback-text 를 넣는다 (audit:I02)
- v0.1.3 (2026-09-20) 저장된 답을 읽고 쓰는 자리가 따로 있어야 순수 계층과 Supabase 가 섞이지 않는다, 지문을 만들려면 workspaceId 가 필요해 stages 도 함께 고친다 (audit:I05)
- v0.1.4 (2026-09-20) 주인 붙이기는 창구 서른 곳을 손대는 별도 일이라 I08a 로 뺀다, I08 은 예산 관문에만 집중한다 (audit:I08)
- v0.1.5 (2026-09-20) I08 범위에 budget.ts 와 budget-gate.ts 를 넣음: 세는 자리가 server-only 를 달고 있어 던지기만 하려는 RFP 관문까지 서버 묶음에 묶였고 단위 시험 8개가 죽었다. 거절 예외를 규칙 계층으로 옮기고 창구를 guarded-call 한 곳에서만 고르게 했다. gemini-call.ts 는 beginGuardedCall 을 이미 지나므로 손대지 않음 (audit:I08)
- v0.1.6 (2026-09-20) I08a 를 셋으로 나눔(I08a 자리와 등재부 / I08b 사람 창구 결선 / I08c 나머지 결선). 벤더로 나가는 파일이 35개이고 주인을 안 넘기는 곳이 10개라 한 항목으로는 한 번에 감사할 수 없었다. guarded-call.ts 는 이미 ctx.actorId 를 원장에 적고 있어 범위에서 뺌, 대신 주인을 받을 자리가 없는 gemini-call.ts 를 넣음 (audit:I08a)
- v0.1.7 (2026-09-20) I08b 에서 daily-prompt-governance 를 빼 I08c 로 옮기고 남은 결선을 I08d 로 밀었다. 그 파일은 자기 인자에 사용자가 없어 부르는 라우트(analyze-work)까지 고쳐야 하는데, 그러면 한 항목이 일곱 파일이 되어 한 번에 감사할 수 없다. 등재부 actor.ts 는 기준선을 내리는 자리라 세 항목 모두의 범위에 들어간다 (audit:I08b)
- v0.1.8 (2026-09-20) I08c 에서 AI 채팅을 빼 I08e(계약을 필수로)와 I08f(호출부 열한 곳 결선)로 나눔. StreamChatParams 를 고치면 호출부 열한 곳이 형 검사에 걸려 한 항목이 열세 파일이 된다. 계약과 결선을 나누면 각각 한 번의 자가감사로 판정된다 (audit:I08c)
- v0.1.9 (2026-09-20) I08c 감사 중 가드 결함 발견: ai-actor 의 «사람이 누르는 자리는 주인을 넘긴다» 가 파일 전체에서 actorId 문자열만 찾아, 인자로 선언만 하고 벤더 호출에 안 넘겨도 통과했다(일부러 넘기는 줄을 빼도 실패하지 않음). 벤더를 부르는 자리의 인자 안을 보도록 고치고 가드 파일을 I08c 범위에 넣음 (audit:I08c)
- v0.1.10 (2026-09-20) 고친 가드가 기존 누락 둘을 바로 찾아내서 I08c 범위에 넣음: gemini-lead 의 내부 도우미가 부르는 셋에게서 userId 를 받고도 관문에 안 넘기고 있었고(리드 해석·판정 호출이 전부 주인 없이 나갔다), gemini-refine 의 옛 길은 부르는 곳이 없어 넘겨받을 사람이 없으므로 사유와 함께 null 을 명시했다. 되돌리면 가드가 빨간 채로 남으므로 그 자리에서 메움 (audit:I08c)
