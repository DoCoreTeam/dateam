# PLAN newAX: CRM AI 도 공급자를 넘어간다 — 한도 하나에 기능이 죽지 않게
플랜 ID: P0026
플랜 버전: v0.2.0
상태: 진행중
지시: ins_0027
목표 버전: v0.10.161
작성: 2026-09-18
시작 커밋: 191b4bfb

## 목표
- CRM AI 12곳이 AI 채팅과 **같은 폴백 체인**을 타게 한다 — Gemini 한도가 바닥나면 OpenAI 로 넘어간다
- CRM AI 가 **한 겹(guardedText)을 지나게** 한다 — 지금은 회사명·사람이름·연락처가 가림도 기록도 없이 나간다
- 실제로 답한 공급자·모델을 기록하고, 갈아탄 사실을 사용자에게 말한다

## 범위 밖
- 새 공급자 추가·키 발급 (OpenAI 키는 이미 등록돼 있다)
- AI 채팅·심층분석 경로 (이미 체인을 탄다)
- GPU 통합입력·회의노트 등 gemini-call.ts 위에 있는 기능 (거기는 이미 사슬이 있다)
- 갈아탄 알림을 CRM 12개 화면 전부에 배선하는 것 — 이번엔 견적 채우기 두 길에만 (나머지는 종합 감사에 남긴다)

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- Gemini 를 인위로 막았을 때 CRM AI 가 OpenAI 로 답한다 (실측)
- 기록에 남는 모델이 **실제로 답한 모델**이다
- 새 테스트는 apps/web/package.json test 스크립트에 등재되어 실제로 돈다
- 설정값 추가 없음 (env 추가 금지)

## 참조
- apps/web/lib/ai-chat/model-chain.ts — 후보 순서 SSOT (buildModelChain·pruneChain), 새로 만들지 않음
- apps/web/lib/ai-chat/provider-errors.ts — 실패 분류 SSOT (scope: model|provider|transient)
- apps/web/lib/ai-chat/analyze-gemini.ts — 같은 전환을 이미 마친 짧은 본보기
- apps/web/lib/ai/guarded-call.ts — 가림·호출원장·전송원장의 한 겹 (@ax/ai-gateway 를 앱에 붙인 자리)
- apps/web/lib/policy/pii-gateway-guard.test.ts — 개인정보가 지나는 길의 등재부. CRM 러너가 여기 없다
- LOOP.md 부록 버전 규칙

## 항목

### I01 CRM 어댑터가 공급자를 넘는다
상태: 통과
모드: 중량
범위:
- apps/web/lib/crm/ai/adapters/host.ts
- apps/web/lib/crm/services/quick-create.ts
- apps/web/lib/crm/ai/adapters/host.test.ts (신규)
- apps/web/package.json (테스트 등재)
감사 기준:
- 어댑터가 buildModelChain 으로 후보를 만든다: Gemini 만 담긴 자작 사슬(resolveGeminiModelChain)이 사라진다
- 실패하면 classifyProviderError 의 scope 로 pruneChain 한다: 429(scope=provider)면 그 공급자의 남은 모델을 전부 뺀다
- 능력을 못 채우는 공급자는 후보에서 빠진다: 첨부가 있으면 vision, 웹 검색이면 tools 를 requires 로 넘긴다
- 후보가 0개면 조용히 끝내지 않고 이유를 말한다
- pnpm test 통과
의존: 없음

### I02 기록에 실제로 답한 모델이 남는다
상태: 통과
모드: 경량
범위:
- apps/web/lib/crm/ai/runner.ts
- apps/web/lib/crm/ai/adapters/host.ts
- apps/web/lib/crm/ai/runner.test.ts (신규)
- apps/web/package.json (테스트 등재)
감사 기준:
- complete() 가 실제로 답한 model·provider 를 함께 돌려주고, 러너가 그 값으로 CrmAiRun 을 남긴다
- 안 돌려주면 예전처럼 adapter.model 을 쓴다 (기존 어댑터·mock 이 안 깨진다)
- 갈아탔으면 runner 결과에 한 줄 알림이 실린다 (formatFallbackNotice 재사용, 새 문장 만들지 않음)
- pnpm test 통과
의존: I01

### I02a CRM AI 가 한 겹을 지난다 — 가림과 전송 기록
상태: 통과
모드: 중량
범위:
- apps/web/lib/crm/ai/runner.ts
- apps/web/lib/crm/ai/ledger.ts (신규)
- apps/web/lib/policy/pii-gateway-guard.test.ts (등재)
- apps/web/package.json (테스트 등재)
감사 기준:
- 러너가 guardedText 를 지난다: 보내기 전에 가리고, 받은 답에서 자리표를 되돌린다
- 두 원장(호출·전송)에 행이 남는다 — 아무것도 안 적는 창구를 만들지 않는다
- 왕복이 원문을 잃지 않는다: 이메일·전화가 든 글을 넣으면 파싱 결과에 원래 값이 그대로 나온다 (추출 기능이 이 계약 위에 있다)
- pii-gateway-guard 의 등재부에 CRM 러너가 있고, 한 겹을 빼면 그 가드가 실패한다
- pnpm test 통과
의존: I01

### I03 갈아탄 사실을 화면이 말한다
상태: 통과
모드: 경량
범위:
- apps/web/lib/crm/services/quote-draft.ts
- apps/web/lib/crm/services/quote-from-file.ts
- apps/web/app/api/crm/quotes/draft/route.ts
- apps/web/components/ui/crm/QuoteFillPanel.tsx
- apps/web/lib/ai-chat/model-chain.test.ts (배선 목록에 CRM 추가)
감사 기준:
- 두 창구(draft·draft-file)가 알림을 그대로 실어 보낸다
- 채우기 패널이 그 알림을 기존 sayNote 자리에 띄운다 (새 자리를 만들지 않는다)
- model-chain.test.ts 의 배선 가드가 CRM 어댑터도 검사한다 — 「여기만 빠지면 429 하나에 통째로 죽는다」가 이번 일의 정확한 재현이었다
- pnpm test 통과
의존: I02a

### I04 실측과 발행
상태: 통과
모드: 경량
범위:
- apps/web/lib/changelog/entries.ts
- package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md
감사 기준:
- Gemini 키를 인위로 막은 상태에서 견적 파일 채우기가 OpenAI 로 답한다 (실측 로그 또는 화면)
- 기록된 모델이 실제로 답한 모델이다 (CrmAiRun 조회)
- 전송 원장에 CRM 행이 실제로 쌓인다 (표 조회, 지금은 0건)
- 버전 여섯 파일이 함께 올랐다: pnpm test 의 policy-sync·version-rule 통과
- entries.ts 맨 위에 이번 버전 블록이 있다
의존: I03

## 종합 감사

명령 (2026-09-19)
- pnpm typecheck 통과 · pnpm lint exit 0 · pnpm design:check 통과
- pnpm test 5879/5879 (플랜 시작 5851 → +28)
- next build (NEXT_DIST_DIR=.next-aichain) 통과, 빌드가 tsconfig 에 넣은 include 줄은 되돌림

실측 — 폴백
- 실제 후보 사슬을 운영 설정으로 뽑아 봄: **gemini → openai → groq** 여섯 후보
  (등록 공급자 셋: gemini/gemini-3-flash-preview · openai/gpt-5.5 · groq/qwen3.8-27b)
- 어제 429 로 죽었던 그 PDF 를 같은 창구에 다시 넣으니 **200**, 항목 2건 정상 추출
- 말로 채우기 응답에 갈아탄 사실이 실림:
  「설정 모델 gemini-3-flash-preview 사용 불가, gemini gemini-flash-latest 로 답했습니다」
- crm_ai_run 에 남은 모델이 **실제로 답한** gemini-flash-latest (이 변경 전 행은 설정 모델 gemini-3-flash-preview)

실측 — 가림과 원장
- 이메일·전화가 든 글을 창구로 보냄. 전송 원장에 CRM 행이 처음 생김:
  surface=crm/quick_create · media_kind=text · **masked_counts={"email":1,"phone":1}** · bytes=3461
- 호출 원장에도 같은 호출이 provider/model/토큰과 함께 남음
- **왕복이 원문을 안 잃음**: 응답의 unclear 에 원래 이메일·전화가 그대로 돌아옴
  (모델이 자리표를 실어 답하고 우리가 되돌린 것)
- 변경 전에는 surface 가 crm 인 원장 행이 **0건**이었다

완료 정의 대조
- 네 명령 전부 통과: 충족
- Gemini 가 막혔을 때 다른 것이 답한다: 충족 (사슬은 공급자를 넘고, 실측에서 모델이 실제로 갈아탔다)
- 기록이 실제로 답한 모델이다: 충족 (crm_ai_run · 두 원장 모두)
- 새 테스트가 실제로 도는가: 5851 → 5879 (+28)
- env 추가 없음: 충족

발견 사항
- 공급자 능력(vision·tools)이 **공급자 단위**라 모델 단위로는 걸러지지 않는다. 그래서 첨부 사슬에
  `gpt-4o-mini-transcribe`(소리 모델)가 후보로 남는다. 400 을 맞고 다음 후보로 넘어가므로 기능은
  살지만 한 번 헛돈다. **AI 채팅도 같은 사슬을 쓰므로 같은 성질이다** — 이번 플랜 밖이고,
  고치려면 `ai_model_catalog` 에 모델별 능력 칸이 필요하다
- 웹 검색은 이 조직에서 여전히 gemini 하나뿐이다(openai·groq 는 registry 상 tools=false).
  그래서 검색 한도는 공급자를 넘어도 안 풀린다 — 새 메시지가 그 사실을 일반화해 말한다

남은 것
- 갈아탄 알림을 받는 화면은 견적 채우기 둘뿐이다. 나머지 CRM AI 열 곳은 러너가 값을 주지만
  화면이 아직 안 그린다 (범위 밖으로 선언했던 것)
- knownNames(사람 이름 가림)는 호출측 선택으로 남겨 뒀다. 규칙 기반(이메일·전화·주민번호·카드·
  계좌·사업자번호)만 열두 곳에 즉시 적용됐다

## 변경 이력
- v0.1.0 (2026-09-19) 최초 작성 (ins_0027)
- v0.2.0 (2026-09-19) 사용자 개입 iv_0061 「우리 AI 패키지 셋업되어 있잖아」 — 패키지를 확인하니 빠진 것이 폴백만이 아니었다. CRM 러너가 `lib/ai/guarded-call.ts` 한 겹을 안 지나 가림도 전송 기록도 없다(pii-gateway-guard 등재부에 CRM 이 없음). I02a 추가
- v0.2.0 (2026-09-18) 사용자 개입 iv_0061 — 패키지를 확인하니 CRM 이 빠진 것이 폴백만이 아니었다. lib/ai/guarded-call.ts 한 겹(가림+호출원장+전송원장, @ax/ai-gateway 를 앱에 붙인 자리)을 CRM 러너가 안 지난다. pii-gateway-guard 등재부 10줄에 CRM 이 없고, 그 길로 회사명·사람이름·연락처·딜 내용이 맨몸으로 나간다. I02a 추가 (iv_0061)
