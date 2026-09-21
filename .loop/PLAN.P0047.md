# PLAN newAX: 등록한 키를 전부 쓴다
플랜 ID: P0047
플랜 버전: v0.1.1
상태: 진행중
지시: iv_0094
목표 버전: v0.10.371
작성: 2026-09-21
시작 커밋: ed3846a8

## 목표
- 등록해 둔 키 넷 가운데 하나만 쓰고 포기하던 AI 호출이 남은 키까지 전부 쓰고 나서야 실패함
- 무료 키가 다 마르면 유료 키가 실제로 불림
- 그래도 다 막혔을 때 화면이 무엇을 몇 개 시도했는지 말함

## 범위 밖
- 키를 더 넣거나 요금제를 바꾸는 일
- 분당 예산 게이트(ai_call_budget) 규칙 변경
- 공급자 순서나 모델 사슬 규칙 변경
- 관리자 화면(AiProviderCard) 개편

## 완료 정의
- pnpm tsc --noEmit, pnpm test, pnpm build 통과
- 호스트 공급자를 부르는 자리가 전부 키 교체를 지남
- 키 교체를 안 지나는 호출이 새로 생기면 테스트가 실패함
- 사용자 노출 문자열은 전부 용어집(@/lib/terms) 또는 기존 문구 자리를 씀

## 참조
- LOOP.md 7절 보안 기준, 부록 버전 규칙
- apps/web/lib/ai/key-rotation.ts withProviderKeys (교체 SSOT)
- apps/web/lib/ai/key-pool.ts orderKeys (무료 먼저, 유료 나중)
- apps/web/app/api/admin/ai-chat/stream/route.ts (이미 옳게 부르는 본보기)
- 실측 2026-09-21 04:17 KST system_events crm_ai quota, 같은 시각 ai_provider_keys 네 줄 last_used_at 전부 비어 있음

## 항목

### I01 호스트 붙임쇠가 등록된 키를 전부 쓴다
상태: 통과
모드: 경량
범위: apps/web/lib/ai-chat/stream-with-keys.ts (신규), apps/web/lib/ai-chat/stream-with-keys.test.ts (신규), apps/web/lib/crm/ai/adapters/host.ts, apps/web/lib/crm/ai/adapters/host.test.ts, apps/web/package.json
감사 기준:
- 가짜 공급자로 첫 키가 429 를 내면 같은 공급자 다음 키로 다시 부르는 것을 실행으로 확인
- 그 공급자 키가 다 마른 뒤에야 다음 공급자 후보로 넘어가는 것을 실행으로 확인
- 전부 막혔을 때 문구가 시도한 공급자 수와 키 수를 담음
- 보안: 새 문구와 콘솔 출력에 키 원문이 없음, 키 이름만 나감
- pnpm test 에서 lib/ai-chat/stream-with-keys.test.ts 와 lib/crm/ai/adapters/host.test.ts 둘 다 통과 (등재 포함)
의존: 없음

### I02 심층분석 세 곳도 같은 자리를 지난다
상태: 통과
모드: 경량
범위: apps/web/lib/ai-chat/analyze-gemini.ts, apps/web/lib/ai-chat/analyze-core.ts, apps/web/lib/ai-chat/analyze-runner-worker.ts
감사 기준:
- 세 파일에서 getProvider(...).streamChat 직접 호출이 0건
- 키를 갈아탈 때 앞 키가 흘린 조각이 답에 섞이지 않음(누적 변수를 쓰는 자리는 비움)
- pnpm tsc --noEmit 통과
의존: I01

### I03 서버 액션 세 곳도 같은 자리를 지난다
상태: 통과
모드: 경량
범위: apps/web/app/(ai)/ai/actions.ts, apps/web/app/(ai)/ai/analyze/actions.ts, apps/web/app/(ai)/ai/analyze/template-actions.ts
감사 기준:
- 세 파일에서 provider.streamChat 직접 호출이 0건
- 대화 제목 생성은 키를 갈아탈 때 앞 키가 흘린 글자를 버림
- pnpm tsc --noEmit 통과
의존: I01

### I04 안 지나는 호출이 다시 생기지 않게 센다
상태: 통과
모드: 경량
범위: apps/web/lib/policy/ai-key-rotation-guard.test.ts (신규), apps/web/package.json
감사 기준:
- 가드가 streamChat 호출 자리를 이름이 아니라 실제 호출 자리로 셈
- 키 교체를 안 지나는 호출을 하나 되살려 가드가 실패하는 것을 확인하고 되돌림
- 등재 뒤 pnpm test 의 총 테스트 수가 등재 전보다 늘어남
의존: I01, I02, I03

### I05 종합 감사와 판 올리기
상태: 통과
모드: 경량
범위: 루트 package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md, apps/web/lib/changelog/entries.ts
감사 기준:
- pnpm tsc --noEmit, pnpm test, pnpm build 통과
- 버전 여섯 파일이 같은 값
의존: I01, I02, I03, I04

## 종합 감사
- pnpm typecheck 오류 0
- pnpm lint 종료코드 0 (경고만, 전부 기존 것)
- pnpm test 6598개 전부 통과, 실패 0
- NEXT_DIST_DIR=.next-p0047 pnpm build 성공 (돌고 있는 dev 서버의 .next 를 안 덮음)
- 완료 정의 대조: 호스트 공급자를 부르는 자리가 전부 키 교체를 지남(직접 호출 허용 3곳은 이유와 함께 목록에 있음), 안 지나는 호출이 새로 생기면 lib/policy/ai-key-rotation-guard.test.ts 가 실패함, 새 사용자 문구는 기존 문구 자리에 수를 더한 것뿐
- 항목 대 결과 대조: I01 신규 2 + 수정 2, I02 수정 3, I03 수정 3, I04 신규 1 + 등재 1, 전부 존재하고 변경됨
- 보안 재측정 (LOOP.md 7절 「기계가 세는 것」, 실행 2026-09-21): RLS 꺼진 표 0, anon 쓰기 표 0, TO public USING(true) 0, search_path 없는 SECURITY DEFINER 0, anon 읽는 SECURITY DEFINER 뷰 0
- 내 커밋 넷의 diff 에 키 접두사(AIzaSy sk-ant sk-proj gsk_ xai-) 0건
- 발견 사항: 같은 결함이 남은 자리가 하나 더 있다. 모델 목록 훑기(listModels describeModels probeModelIds)는 여전히 META 키 하나만 쓴다. 채팅 호출이 아니라 이번 범위 밖이고, 막히면 카탈로그가 안 갱신될 뿐 사용자 요청이 죽지는 않는다

## 변경 이력
- v0.1.0 (2026-09-21) 최초 작성 (iv_0094)
- v0.1.1 (2026-09-21) 실행으로 재는 시험 자리를 새 모듈 옆에 두고 등재까지 I01 범위에 넣었다 (audit:I01)
