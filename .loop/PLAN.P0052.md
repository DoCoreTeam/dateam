# PLAN newAX: 모델 목록 훑기도 등록한 키를 쓴다
플랜 ID: P0052
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0088
목표 버전: v0.10.399
작성: 2026-09-22
시작 커밋: df0608ef

## 목표
- 첫 키가 막혀도 모델 카탈로그 갱신이 다음 키로 이어져 끝까지 훑음
- 크레딧이 마른 키 하나가 멀쩡한 모델들을 「못 쓴다」로 적어 두는 일이 없어짐
- 연결 테스트는 고른 그 키를 그대로 시험함, 다른 키로 성공해 놓고 된다고 말하지 않음

## 범위 밖
- 채팅 호출 경로 (P0047 에서 이미 키 교체를 지남)
- 가용 상태 재사용 창(6시간) 규칙 변경
- 카탈로그 표 구조나 모델 큐레이션 규칙 변경
- 관리자 화면 개편

## 완료 정의
- pnpm tsc --noEmit, pnpm test, pnpm build 통과
- 모델 목록과 프로브가 키 교체를 지나되, 연결 테스트는 안 지남
- 프로브가 「이 키가 죽었다」와 「이 모델이 죽었다」를 따로 말함
- 안 지나는 호출이 새로 생기면 테스트가 실패함

## 참조
- LOOP.md 7절 보안 기준, 부록 버전 규칙
- apps/web/lib/ai/key-rotation.ts withProviderKeys (교체 SSOT)
- apps/web/lib/ai-chat/stream-with-keys.ts (P0047 이 만든 같은 모양)
- apps/web/lib/ai-chat/probe-result.ts classifyModelProbeFailure (계정 실패 판정 SSOT)
- 실측 2026-09-21 ai_provider_keys 여섯 줄 last_used_at 전부 비어 있었음

## 항목

### I01 프로브가 이 키가 죽었다고 말한다
상태: 진행중
모드: 경량
범위: apps/web/lib/ai-chat/provider.ts, apps/web/lib/ai-chat/probe-result.ts, apps/web/lib/ai-chat/probe-models.ts, apps/web/lib/ai-chat/probe-models.test.ts (신규), apps/web/package.json
감사 기준:
- 크레딧 소진은 quota, 401 은 auth 로 갈라져 나옴 (실행으로 확인)
- probeModelIdsWithKeys 가 첫 키의 계정 실패에서 다음 키로 넘어가는 것을 가짜 공급자로 확인
- 키가 전부 계정 실패면 마지막 결과 표를 그대로 돌려줌 (지금 동작이 안 나빠짐)
- 모델 단위 실패(404, 429, 403)로는 키를 안 태움
- 보안: 프로브 오류 원문과 키 이름만 다루고 키 원문은 어디에도 안 실림
의존: 없음

### I02 카탈로그 갱신이 키를 갈아 가며 훑는다
상태: 대기
모드: 경량
범위: apps/web/app/(ai)/ai/actions.ts
감사 기준:
- 목록 조회와 프로브가 둘 다 키 교체를 지남
- 목록을 성공시킨 그 키로 프로브를 시작함 (두 단계가 다른 키를 쓰지 않음)
- pnpm tsc --noEmit 통과
의존: I01

### I03 관리자 모델 목록은 갈아타고 연결 테스트는 안 갈아탄다
상태: 대기
모드: 경량
범위: apps/web/app/admin/settings/actions.ts
감사 기준:
- listProviderModels 가 키 교체를 지남
- checkProviderConnection 은 고른 키 하나만 쓰고, 그 이유가 코드에 적혀 있음
- pnpm tsc --noEmit 통과
의존: I01

### I04 안 지나는 훑기가 다시 생기지 않게 센다
상태: 대기
모드: 경량
범위: apps/web/lib/policy/ai-key-rotation-guard.test.ts
감사 기준:
- probeModelIds 직접 호출은 SSOT 안에서만 허용
- listModels 와 describeModels 를 부르는 파일은 키 교체도 부름, 예외는 이유와 함께 목록에 있음
- 규칙을 일부러 깨뜨려 실패를 확인하고 되돌림
의존: I01, I02, I03

### I05 종합 감사와 판 올리기
상태: 대기
모드: 경량
범위: 루트 package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md, apps/web/lib/changelog/entries.ts
감사 기준:
- pnpm tsc --noEmit, pnpm test, pnpm build 통과
- 버전 여섯 파일이 같은 값
의존: I01, I02, I03, I04

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-22) 최초 작성 (ins_0088)
