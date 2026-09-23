# PLAN newAX: 유료키까지 가 닿게 한다
플랜 ID: P0055
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0106
목표 버전: v0.10.432
작성: 2026-09-23
시작 커밋: e93c2b40

## 목표
- 무료키가 과부하로 막혀도 등록해 둔 유료키까지 순서가 돌아간다
- 「전부 사용량 한도」라고 말하기 전에 실제로 전부 두드려 본다
- 키 하나의 사정이 모델 전체를 죽은 것으로 적어 두지 않는다

## 범위 밖
- openai 크레딧 충전 (사용자가 결제로 푸는 일)
- groq 이 그림 첨부 체인에 들어가는 것 자체 (능력 표기 문제, 별건)
- 견적서 읽기 화면과 프롬프트

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 첫 키가 503 을 내면 등록된 다음 키로 넘어가고 유료키까지 닿는다 (실행으로 확인)
- 원인 불명 실패에서는 키를 안 태운다 (503 만 넘어간다)
- ai_model_catalog 에서 유료키로 되는 모델이 available 로 돌아온다 (실측 대조)
- 실제 견적서 파일 올리기가 성공한다 (실브라우저)

## 참조
- apps/web/lib/ai/key-rotation.ts:117 (transient 에서 교체를 포기하던 자리)
- apps/web/lib/ai-chat/provider-errors.ts (분류 SSOT, 여기 말고 다른 데서 분류하지 않는다)
- apps/web/lib/ai/key-pool.ts (등급과 쉬는 시간 규칙)
- apps/web/lib/ai-chat/probe-models.ts (probeModelIdsWithKeys 가 이미 있고 배선만 없다)
- 실측 2026-09-23: 유료키는 4개 모델 전부 200, 무료키 3개는 gemini-flash-latest 에서 전부 503

## 항목

### I01 과부하는 다음 키로 넘어간다
상태: 통과
모드: 경량
범위: apps/web/lib/ai-chat/provider-errors.ts, apps/web/lib/ai/key-pool.ts, apps/web/lib/ai/key-rotation.ts, apps/web/lib/crm/ai/adapters/host.ts, apps/web/lib/ai/key-rotation.test.ts
감사 기준:
- 보안: 새 데이터도 새 창구도 없고 밖에서 온 값을 새로 다루지도 않는다. 오류 문구 분류만 바뀐다. 해당 없음
- classifyProviderError 가 503 과 overloaded 와 high demand 를 keyOutcome overload 로 분류한다. 404 no longer available 은 그대로 model 이다
- withProviderKeys 가 overload 에서 다음 키를 부르고 transient 에서는 안 부른다. 두 방향 다 시험한다
- nextKeyState 가 overload 를 quota 로 적지 않는다 (disabled_reason 이 안 바뀐다)
- host.ts 가 전부 과부하일 때 「한도」가 아니라 과부하로 말한다
- pnpm tsc --noEmit 통과
의존: 없음

### I02 요청이 너무 크면 키를 벌주지 않는다
상태: 통과
모드: 경량
범위: apps/web/lib/ai-chat/provider-errors.ts, apps/web/lib/ai-chat/provider-errors.test.ts
감사 기준:
- 보안: 분류만 바뀐다. 해당 없음
- request too large 가 섞인 429 를 scope model 로 분류하고 keyOutcome 을 안 준다
- 그냥 429 는 여전히 key 와 quota 다 (일부러 깨뜨려 확인)
- pnpm tsc --noEmit 통과
의존: 없음

### I03 카탈로그가 키 하나의 사정을 모델에 안 적는다
상태: 대기
모드: 경량
범위: apps/web/app/(ai)/ai/actions.ts, apps/web/lib/ai-chat/probe-models.ts, apps/web/lib/ai-chat/probe-models.test.ts, apps/web/package.json
감사 기준:
- 보안 S2: 재훑기는 관리자 서버 액션 안에서만 불린다. 키 원문이 응답에 안 실린다
- 훑기가 등록된 키 전부를 돌고 한 모델이라도 되는 키가 있으면 available 로 적는다
- 되는 키가 하나도 없을 때만 unavailable 이다
- 새 시험이 package.json test 스크립트에 등재되고 총 건수가 실제로 는다
- pnpm tsc --noEmit 통과
의존: I01

### I04 실제로 되는지 확인하고 판을 올린다
상태: 대기
모드: 경량
범위: package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md, apps/web/lib/changelog/entries.ts
감사 기준:
- 카탈로그를 다시 훑고 gemini 의 available 수가 4보다 커진다 (실측 대조)
- 견적서 파일 올리기가 실제로 성공한다
- 버전 파일 여섯이 v0.10.432 로 같이 오른다
의존: I01, I02, I03
