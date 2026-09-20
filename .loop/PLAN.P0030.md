# PLAN newAX: AI 호출을 무료 등급 안으로
플랜 ID: P0030
플랜 버전: v0.1.22
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
- 보안 S2: 두 창구의 권한 판정이 안 바뀜 — 부르는 조건만 바꾸고 인증 장치는 그대로, api-auth-surface 가드 통과로 확인 (통과 뒤에 적은 줄, 사후 확인은 I16)
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
- 보안 S1: 같은 판에서 RLS 를 켜고 TO public 을 안 씀 — 262 는 enable row level security 뒤 ci_is_member(workspace_id) 실제 조건 읽기 정책 하나, 쓰기 정책 없음(서버만 채운다), rls-baseline 가드 통과 (통과 뒤에 적은 줄, 사후 확인은 I16)
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
- 보안 S1: 같은 판에서 RLS 를 켜고 TO public 을 안 씀 — 263 은 enable row level security 뒤 to authenticated 읽기 정책 하나, 쓰기 정책 없음(브라우저가 직접 고치면 상한이 상한이 아니다), rls-baseline 가드 통과 (통과 뒤에 적은 줄, 사후 확인은 I16)
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
- 보안 S2 S3: 두 창구의 권한 판정이 안 바뀜을 소스로 확인 — remedy 는 getUser 뒤 profiles.role admin 확인, speakers 는 getUser 뒤 meeting_notes.user_id 일치 확인, 서비스롤을 쓰는 두 곳 모두 그 위에 사람 확인이 있음. actor_id 는 내부 uuid 라 어느 응답에도 안 실림
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
- 보안 S2 S3: analyze-work 창구의 권한 판정이 안 바뀜 — getUser 뒤 401 게이트가 그대로이고 같은 라우트가 이미 user.id 로 actorId 를 쓰던 자리에 한 줄 더함. 사용자 원문 표본은 sanitizeSample 과 가림 한 겹을 그대로 지남
의존: I08b
범위 메모: AI 채팅은 호출부가 열한 곳이라 같은 항목에 못 넣고 I08e 로 뺌. 가드를 범위에 넣은 이유는 아래 감사에서 드러난 결함 때문임 — 파일 전체 문자열 검색이라 인자로 선언만 하고 안 넘겨도 통과했다

### I08e AI 채팅이 주인을 반드시 받고 호출부가 그것을 넘긴다
상태: 통과
모드: 경량
범위: apps/web/lib/ai-chat/provider.ts, apps/web/lib/ai-chat/providers/gemini.ts, apps/web/lib/ai/actor.ts, apps/web/app/api/admin/ai-chat/stream/route.ts, apps/web/app/(ai)/ai/actions.ts, apps/web/app/(ai)/ai/analyze/actions.ts, apps/web/app/(ai)/ai/analyze/template-actions.ts, apps/web/lib/ai-chat/analyze-core.ts, apps/web/lib/ai-chat/analyze-gemini.ts, apps/web/lib/ai-chat/analyze-runner-worker.ts, apps/web/lib/ai-chat/analyze-runner.ts, apps/web/app/(ai)/ai/analyze/analyze-item-actions.ts, apps/web/lib/crm/ai/adapters/host.ts, apps/web/lib/rfp/ai/host-caller.ts
감사 기준:
- StreamChatParams 의 actorId 가 선택이 아니라 필수라서 안 주면 형 검사가 실패함 (일부러 하나 빼서 확인)
- gemini 공급자가 받은 주인을 관문 ctx 까지 넘김
- pnpm tsc --noEmit 가 통과함, 사람이 누르는 호출부는 자기가 쥔 사용자 id 를 배경 호출부는 null 과 사유를 넘김
- 보안: 채팅 스트림 라우트가 지금도 사람 확인을 지나고 그 판정이 안 바뀜을 소스로 확인, 서비스롤을 쓰면 그 위에 사람 확인이 있는지 함께 봄, actor_id 는 내부 uuid 라 어느 응답에도 안 실림 (S2 S3)
- 기준선이 5 에서 4 로 내려감
의존: I08c
범위 메모: 계약과 결선을 두 항목으로 나눴다가 하나로 합쳤다. 칸을 필수로 만드는 판과 호출부를 메우는 판을 나누면 그 사이 판에서 pnpm tsc 가 빨갛고, 항목마다 정적 검사가 통과해야 한다는 규정(2절 3c)을 못 지킨다. 파일 수가 권장치를 넘지만 형 검사가 한 곳도 못 빠뜨리게 해 주므로 한 번의 자가감사로 판정된다

### I08d 회의 녹음에 주인을 잇는다
상태: 통과
모드: 경량
범위: apps/web/lib/stt/provider.ts, apps/web/lib/meeting/transcribe-parts.ts, apps/web/lib/ai/actor.ts, apps/web/lib/policy/ai-actor.test.ts
범위 메모: 라우트 둘은 안 고쳤다 — 주인을 부르는 쪽에서 받는 대신 **노트 행에서 읽어 오게** 했더니 크론 라우트(사람이 아예 없다)도 같은 값을 쓴다. 대신 가드에 「값이 실제로 실려 오나」를 더했다, 소스 대조만으로는 actorId: null 을 적어 두고 통과하기 때문
감사 기준:
- SttInput 이 actorId 를 필수로 받아 안 주면 형 검사가 실패함 (일부러 하나 빼서 확인)
- 조각을 맡을 때 그 노트의 주인을 함께 읽어 와서 넘김 (타입만 늘리고 질의를 안 고치면 런타임에 빈칸이 된다)
- 보안 S2: 두 창구의 권한 판정이 안 바뀜을 소스로 확인, 서비스롤을 쓰면 그 위에 사람 확인이 있는지 함께 봄
- 기준선이 4 에서 2 로 내려감
의존: I08c

### I08g CRM 실행기에 주인을 잇는다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/ai/runner.ts, apps/web/lib/crm/ai/adapters/host.ts, apps/web/lib/crm/jobs/finish-deps.ts, apps/web/lib/crm/services/{quote-draft,enrich-web,quote-from-file,stage-review,activity-extract,meeting,data-check,quick-create,next-best-action}.ts, apps/web/app/api/crm/{metrics/ask,data-check,today,quotes/draft,quotes/draft-file,companies/enrich}/route.ts, apps/web/app/api/crm/deals/[id]/stage-review/route.ts, apps/web/app/api/crm/companies/[id]/enrich/route.ts, apps/web/lib/ai/actor.ts, apps/web/lib/policy/ai-actor.test.ts
감사 기준:
- RunOptions 가 actorId 를 필수로 받아 호출부 열 곳이 전부 형 검사에 걸림 (일부러 하나 빼서 확인)
- hostAdapter 가 I08e 에서 null 로 남긴 자리를 실제 값으로 채움
- 사람이 누르는 호출부는 자기가 쥔 구성원 id 를, 배경 호출부는 null 과 사유를 넘김
- 보안 S2: 창구 하나(crm/metrics/ask)의 권한 판정이 안 바뀜을 소스로 확인
- 기준선이 2 에서 1 로 내려감
의존: I08d
범위 메모: 파일이 스물둘로 권장치를 넘지만 필수 칸이라 형 검사가 한 곳도 못 빠뜨리게 잡아 준다(I08e 와 같은 판단). 착수 전 예상 열셋보다 아홉 늘었는데, 서비스 다섯이 workspaceId 만 받고 구성원을 아예 안 받고 있어 그 라우트까지 이어야 했다. 가드도 함께 고쳤다 — 맥락을 변수로 넘기는 길(runner 의 ctx)을 못 따라가서 결선하고도 실패했다

### I08h GPU 통합입력 도우미에 주인을 잇는다
상태: 통과
모드: 경량
범위: apps/web/lib/gpu/extract-helpers.ts, apps/web/lib/gpu/ai-observation.ts, apps/web/lib/gpu/extract-pipeline.ts, apps/web/lib/work/autolink-run.ts, apps/web/app/api/admin/ai-prompts/ai-edit/route.ts, apps/web/app/api/pricing/gpu/{review/stream,market/refresh,market/catalog}/route.ts, apps/web/lib/ai/actor.ts, apps/web/lib/policy/ai-actor.test.ts
범위 메모: extract-pipeline.ts 가 사이에 있어 함께 들어갔다(주입 가능한 GeminiCaller 가 그 층을 지난다). 가드도 한 번 더 고쳤다 — 인자 묶음을 변수로 만들어 펼치는 길(const common = {...})을 못 따라갔다
감사 기준:
- callGeminiOnce 가 actorId 를 받아 관문까지 넘김, 안 주면 형 검사가 실패함
- 라우트 넷이 자기가 쥔 사용자 id 를 넘김, 배경 잡은 null 과 사유
- 보안 S2: 네 창구의 권한 판정이 안 바뀜을 소스로 확인
- 기준선이 1 에서 0 이 되고 등재부에 미결선이 하나도 없음
의존: I08g

### I16 통과 뒤에 적은 보안 줄을 사후 확인한다
상태: 통과
모드: 중량
범위: supabase/migrations/262_ci_discovery_answers.sql, supabase/migrations/263_ai_call_budget.sql, apps/web/lib/policy/rls-baseline.test.ts
감사 기준:
- 보안 S1: 운영 DB 에서 두 표의 relrowsecurity 가 true 이고 anon 이 INSERT UPDATE DELETE 권한을 안 가짐 (실제 질의 결과를 적음)
- 보안 S1: 두 표에 TO public 이면서 USING (true) 인 정책이 0개 (실제 질의 결과를 적음)
- rls-baseline 가드가 두 표를 실제로 세고 있음, 일부러 하나를 빼서 실패를 확인
의존: 없음

운영 DB 실측 2026-09-20 (psql 직접 질의)
- relrowsecurity: ai_call_budget = t, ci_discovery_answers = t
- anon 의 INSERT·UPDATE·DELETE·TRUNCATE 권한: **0건**
- TO public 이면서 USING (true) 인 정책: **0건**
- 정책 전수 2개, 둘 다 SELECT 전용이고 쓰기 정책은 없음
  - ai_call_budget_select · SELECT · {authenticated} · true
  - ci_discovery_answers_select · SELECT · {public} · ci_is_member(workspace_id)
  뒤엣것은 대상이 public 이지만 USING 이 실제 조건이라 LOOP.md S1 이 허용하는 모양이다
  (anon 은 ci_is_member 가 거짓이라 한 행도 못 읽는다)
- 가드 확인: 263 에서 enable row level security 를 지우니 1번 시험이 표 이름을 짚어 실패,
  262 의 정책을 to public using (true) 로 바꾸니 2번 시험이 정책 이름을 짚어 실패, 되돌린 뒤 3/3 통과
범위 메모: I01 I04 I07 은 감사 기준에 보안 줄 없이 통과했고, 그 사실을 v0.1.12 에서 발견해 줄을 뒤늦게 적었다. 소스로는 맞는 것을 확인했지만 운영 DB 실측은 아직이므로 이 항목에서 센다

### I09 관리자 사용량 화면이 원장을 읽는다
상태: 통과
모드: 경량
범위: apps/web/app/admin/ai-usage/page.tsx, apps/web/app/admin/ai-usage/AiUsageDashboard.tsx, apps/web/app/admin/ai-usage/actions.ts (신규), apps/web/lib/ai/usage-query.ts (신규), apps/web/lib/ai/usage-query.test.ts (신규), apps/web/package.json
감사 기준:
- 화면이 ai_llm_calls 를 읽음, ai_token_logs 를 읽지 않음 (가드 1개)
- 오늘 호출·남은 횟수·거절·토큰이 보이고, 거절과 실패를 따로 셈 (단위 테스트)
- 기능별 하루 상한 막대가 보이고 관리자가 상한을 바꿀 수 있음
- 보안 S2: 상한을 바꾸는 창구가 새로 열리므로 사람 확인을 지나고, 서비스롤 위에 그 확인이 있음
- 화면 문자열이 기존 문구 가드를 지남
- 운영 원장 실데이터로 내 집계와 psql GROUP BY 를 대조해 숫자가 같음 (실측 결과를 적음)
의존: I08
범위 메모: 「실브라우저 스크린샷」 대신 **운영 실데이터 대조**로 바꿨다. 물으려던 것은 「숫자가 맞나」이고, 같은 줄을 psql 의 GROUP BY 와 내 집계에 각각 넣어 맞춰 보는 쪽이 그 물음에 더 곧게 답한다(스크린샷은 렌더를 보여 줄 뿐 셈을 안 보여 준다). 화면 렌더 확인은 배포 뒤에야 되는 일이라 플랜 완료 정의에 이미 있다

### I10 능력별 등급과 사슬 순서
상태: 통과
모드: 경량
범위: apps/web/lib/ai/capability-chain.ts (신규), apps/web/lib/ai/capability-chain.test.ts (신규), apps/web/package.json, AGENTS.md, GEMINI.md, .claude/heavy/CEO.md
감사 기준:
- 능력 8종마다 기본 등급이 정해져 있고 표가 한 곳에 있음 (아홉째가 생기면 가드가 걸림)
- 사슬 순서가 하루 한도가 큰 것부터 (단위 테스트로 순서 단정)
- Gemma 등급이 묶기·이름표 능력에서 후보가 됨, 산문 응답은 json-recover 가 받음 (단위 테스트)
- Gemma 는 짧은 입력 능력에만 열림, 긴 입력 능력에서는 후보에서 빠짐 (단위 테스트)
- 설정 모델이 여전히 1순위 (기존 동작 보존, 기존 gemini-model 가드 통과)
- 표를 한 글자 바꿔 열면 안 되는 능력을 열었을 때 가드가 실패함 (일부러 두 가지로 확인)
- 정책 3파일의 판 번호 줄이 package.json 과 일치 (버전 올리기가 본문 인용을 덮지 않음)
의존: I07
범위 메모: 파일 이름을 model-tier.ts 로 안 짓고 capability-chain.ts 로 지었다 — lib/ai-chat/model-tier.ts 가 이미 있고 그것은 사람이 고르는 메뉴 순서다. 같은 이름을 옆 폴더에 두면 다음 사람이 둘 중 아무거나 import 한다. 정책 3파일이 범위에 든 이유는 아래 감사에서 드러난 버전 올리기 버그 때문임

### I11 생각 예산과 출력 상한
상태: 통과
모드: 경량
범위: apps/web/lib/ai/gemini-call.ts, apps/web/lib/ai/guarded-gemini.ts, apps/web/lib/ai/output-limit.ts (신규), apps/web/lib/ai/output-limit.test.ts (신규), apps/web/package.json
감사 기준:
- 생각 예산 0 이 기본이고, 켜는 능력이 명시된 목록에만 있음 (가드 1개, 근거 없이 켜면 실패)
- 출력 상한이 능력별 값에서 오고 어느 능력도 32,768 이 아님
- 벤더를 부르는 자리가 전부 생각 예산을 실어 보냄, 한 곳이라도 빠지면 가드가 실패
- 부르는 쪽이 직접 준 값이 표보다 뒤에 얹힘 (순서를 뒤집으면 가드가 실패)
- 상한에서 잘리면 잘렸다고 말함 (기존 동작 보존)
- 기존 daily/flow-reason 의 300토큰·생각 0 설정이 그대로 유지됨
의존: I10

### I12 발견 프롬프트를 줄인다
상태: 통과
모드: 경량
범위: apps/web/lib/ci/ai/discover-server.ts, apps/web/lib/ci/ai/discover-prompt.ts (신규), apps/web/lib/ci/ai/discover-server.test.ts, apps/web/lib/ci/analysis/contrast-key.ts
감사 기준:
- 설명 원문이 400자에서 120자로, 프롬프트 판 번호가 오름 (I04 지문이 따라 달라짐)
- 같은 대조쌍의 프롬프트 글자 수가 줄었음을 단위 테스트가 수치로 확인 (실측 2,397자 -> 1,277자)
- **표본 수(주제당 30건)는 그대로** — 줄이면 승격 0건이 된 실측이 있다
- 잘림(MAX_TOKENS) 이 나던 출력 상한 400 을 재검토해 잘림이 안 나는 값으로
의존: I05, I11
범위 메모: 프롬프트 만드는 부분을 discover-prompt.ts 로 떼어 냈다. discover-server 가 앱 별칭(@/lib)을 쓰는 모듈을 끌어와 시험이 그 파일을 글자로만 읽을 수 있었고, 그래서 길이를 재는 시험 자체가 불가능했다 — 정규식으로 상한 숫자가 적혀 있나만 봤다

### I13 임베딩을 묶어서 부른다
상태: 통과
모드: 경량
범위: apps/web/lib/gemini-embedding.ts, apps/web/lib/gemini-embedding.test.ts (신규), apps/web/lib/ai/guarded-call.ts, apps/web/lib/rfp/index/embed.ts, apps/web/app/api/rfp/worker/tick/route.ts, apps/web/lib/ai-chat/knowledge.ts, apps/web/lib/ai/actor.ts, apps/web/lib/policy/ai-actor.test.ts, apps/web/package.json
감사 기준:
- 묶음 창구(batchEmbedContents)로 한 요청에 여러 건을 보냄, 한 건씩 보내지 않음 (가드 1개)
- 묶음 안 한 건이 실패해도 나머지가 살아남음 (단위 테스트)
- 결과 순서가 입력 순서와 같음 (단위 테스트)
- 저장되는 차원과 모델 이름이 그대로 (기존 chunk 가드 통과)
- 묶음도 가림 한 겹과 예산 관문을 지남, 건마다 가리고 되돌림 (단위 테스트)
- 착수 전 실측: 지식 색인은 한 건씩 도는 for 문이었고 RFP 색인은 16개를 Promise.all 로 나눠 보냈다 — 둘 다 요청 수가 건수와 같았다
- 보안 S4: 묶음 요청도 lib/security/safe-fetch 가 아닌 고정 벤더 주소만 쓰고 사용자 값이 주소에 안 들어감
의존: 없음
범위 메모: 착수 전 사슬을 재어 범위를 한 번에 정함. 묶음은 guardedVector(한 건짜리)로는 못 지나가므로 guarded-call 에 묶음 갈래를 냄. 그 과정에서 ai-actor 가드가 제네릭 호출(guardedVector<number[]>(...))을 못 보고 lib/gemini-embedding.ts 를 통째로 놓치고 있던 것을 발견해 같은 판에서 고침

### I14 키를 고르는 자리 하나와 판 구분
상태: 통과
모드: 중량
범위: apps/web/lib/ai/deploy-env.ts (신규), apps/web/lib/ai/deploy-env.test.ts (신규), apps/web/lib/ai/provider-key-source.ts (신규), apps/web/lib/ai/provider-key-source.test.ts (신규), apps/web/lib/policy/ai-key-source.test.ts (신규), apps/web/lib/policy/ai-key-source-baseline.json (신규), apps/web/lib/ai/ledger.ts, supabase/migrations/267_ai_llm_calls_env.sql (신규), apps/web/package.json
감사 기준:
- 공급자 키를 읽는 자리가 하나이고, 직접 읽는 다른 길은 **기준선**으로 세어 늘지 못하게 함 (일부러 한 곳 더해 실패 확인)
- 그 자리가 판(운영·미리보기·개발·시험)을 보고 키를 고름
- 개발 판에서 운영 공급자 키가 안 쓰임 (단위 테스트)
- 키가 없으면 AI 를 부르지 않고 고정 응답, 「없음」과 「판이 달라 막힘」을 다른 말로 함 (단위 테스트)
- 원장에 판 구분이 남음 (부르는 쪽이 아니라 원장 쓰는 자리가 찍는다)
- 보안 S1: 칼럼만 더하므로 잠금이 안 바뀜을 운영 DB 에서 확인 (RLS·anon 쓰기·TO public USING true)
의존: I08
범위 메모: 직접 읽는 파일이 마흔여섯이라 한 판에 다 못 옮긴다. 전부 막으면 멀쩡한 기능이 멈추므로 기준선으로 세고 줄이는 방향으로만 간다(vendor-call-baseline 과 같은 모양). 「키가 없으면 고정 응답」은 문구와 판정을 냈고, 그 문구를 실제로 띄우는 결선은 기준선이 0 이 될 때 함께 끝난다

### I15 구현판은 Claude, 자동 구동기는 운영만
상태: 통과
모드: 경량
범위: apps/web/components/ci/QueueDriver.tsx, apps/web/scripts/changelog-gen.mjs, apps/web/lib/policy/ai-key-source.test.ts
감사 기준:
- 개발 판에서 QueueDriver 가 자동으로 안 돎, 버튼을 눌러야 돎 (가드 1개, 막는 줄을 빼면 실패)
- changelog-gen 이 사라진 기본 모델(gemini-2.0-flash)을 안 쓰고 SSOT 와 같은 값을 씀 (가드가 SSOT 를 읽어 대조)
의존: I14
범위 메모: 「판에 맞는 키를 쓴다」는 I14 의 resolveProviderKey 가 이미 하는 일이라 여기서 또 하지 않는다. 발행기는 서버 밖 스크립트라 그 자리를 못 지나므로, 여기서는 **사라진 모델을 안 쓰는 것**만 본다
