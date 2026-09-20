# PLAN newAX: AI 공급자 키를 여러 개 두고 한도에 걸린 키를 건너뛴다
플랜 ID: P0032
플랜 버전: v0.1.2
상태: 진행중
지시: ins_0034
목표 버전: v0.10.214
작성: 2026-09-20
시작 커밋: 1fef26a6

## 목표
- 공급자마다 API 키를 여러 개 저장하고 순서를 정할 수 있음
- 한도 초과나 인증 실패가 난 키는 자동으로 건너뛰고 다음 키로 이어서 호출함
- 다섯 공급자(Gemini, Claude, OpenAI, Groq, Grok)가 같은 방식으로 동작함
- 어느 키가 지금 쓸 수 있고 어느 키가 막혔는지 관리자 화면에서 보임

## 범위 밖
- 키 암호화 저장 (복호 열쇠를 둘 자리가 env 뿐이라 이번에 하지 않음, 표를 service_role 밖으로 열지 않는 수준은 유지)
- 무료 키를 어디서 어떻게 발급받을지 (사용자가 직접 처리)
- 공급자 추가 (다섯 공급자 그대로)
- 사용량 예측이나 비용 최적화 자동 배분

## 완료 정의
- pnpm tsc --noEmit, pnpm test, pnpm build 통과
- 키를 두 개 이상 저장했을 때 첫 키가 429 를 받으면 같은 공급자의 다음 키로 넘어감
- 키 한 개만 저장된 상태의 동작이 지금과 같음
- 원문 API 키가 어떤 응답에도 담기지 않음
- 사용자 노출 문자열은 전부 @/lib/terms 상수 또는 기존 i18n 경로 사용
- 설정값은 env 추가 없이 DB 저장과 UI 관리

## 참조
- LOOP.md 7절 보안 기준
- apps/web/lib/ai/provider-catalog.ts 공급자 명세 SSOT
- apps/web/lib/ai-chat/provider-errors.ts 실패 분류 SSOT
- docs/policy/security.md 기계가 세는 다섯 줄

## 항목

### I01 키 보관 자리와 잠금
상태: 통과
모드: 중량
범위: supabase/migrations/264_ai_provider_keys.sql (신규)
감사 기준:
- 마이그레이션 적용 후 ai_provider_keys 에 RLS 가 켜져 있음 (pg_class.relrowsecurity = true)
- anon 과 authenticated 가 SELECT INSERT UPDATE DELETE 권한을 갖지 않음 (information_schema.role_table_grants 조회 0행)
- 기존 org_content META 의 다섯 키가 각 공급자 첫 줄로 시드됨 (provider 별 count >= 1, 단 META 에 값이 있던 공급자만)
- TO public 정책이 0개
의존: 없음

### I02 고르는 규칙 한 벌
상태: 통과
모드: 경량
범위: apps/web/lib/ai/key-pool.ts (신규), apps/web/lib/ai/key-pool.test.ts (신규), apps/web/package.json
감사 기준:
- pnpm test 에 key-pool 등재되고 실제로 돎 (총 테스트 수가 늘어남)
- 키 셋 중 가운데가 쿨다운 중이면 시도 순서에서 빠지고 나머지 둘이 순서대로 나옴
- 전부 쿨다운이면 빈 목록이 아니라 가장 빨리 풀리는 키 하나를 돌려줌
- 429 를 받은 키의 다음 상태 쿨다운 해제 시각이 지금보다 뒤임
- 401 을 받은 키는 쿨다운이 아니라 사용 중지로 표시됨
의존: 없음

### I03 실패를 키 단위로 읽기
상태: 통과
모드: 경량
범위: apps/web/lib/ai-chat/provider-errors.ts, apps/web/lib/ai-chat/provider-errors.test.ts, apps/web/lib/ai-chat/model-chain.ts, apps/web/lib/ai-chat/model-chain.test.ts, apps/web/lib/crm/ai/adapters/host.test.ts
감사 기준:
- classifyProviderError 가 429 에 scope 'key' 와 keyOutcome 'quota' 를 돌려줌 (limit: 0 은 지금대로 'model')
- classifyProviderError 가 401 403 에 scope 'key' 와 keyOutcome 'auth' 를 돌려줌
- pruneChain 이 scope 'key' 를 'provider' 와 같게 다룸 (키 교체는 pruneChain 앞에서 끝난다, 여기까지 온 것은 그 공급자 키가 다 마른 것)
- 이 항목에서는 availability 를 건드리지 않음, 한도를 그 값으로 읽는 소비처 셋이 아직 살아 있음
- pnpm test provider-errors model-chain host 통과
의존: 없음

### I03a 한도 판정을 모델 상태에서 떼어낸다
상태: 대기
모드: 경량
범위: apps/web/lib/ai-chat/provider-errors.ts, apps/web/lib/crm/ai/runner.ts, apps/web/lib/crm/ai/adapters/host.ts, apps/web/lib/crm/ai/provider-quota.test.ts, apps/web/lib/api-docs/ai-layer.ts
감사 기준:
- runner 가 availability 가 아니라 keyOutcome 으로 PROVIDER_QUOTA 를 던짐 (429 가 VALIDATION_FAILED 로 내려가면 여러 건 돌 때 중단 조건에 안 걸려 확정된 실패 호출이 수십 번 나감, v0.7.574 실측)
- CRM 어댑터의 「전부 사용량 한도에 걸렸습니다」 안내가 그대로 나옴, 판정 근거만 keyOutcome 으로 바뀜
- 429 가 더 이상 availability 'limited' 를 남기지 않음 (한도는 키의 상태이지 모델의 상태가 아님, 남기면 다른 키를 가진 사람에게도 그 모델이 내려간다)
- 404 는 지금대로 availability 'unavailable' 을 남김 (없어진 모델은 정말 모델의 상태다)
- 개발자센터 AI_FAILURE_RULES 가 바뀐 갈래를 설명함
- pnpm test provider-quota host crm 통과
의존: I03

### I04 서버 키 저장소
상태: 대기
모드: 중량
범위: apps/web/lib/ai/key-store.ts (신규), apps/web/lib/ai/key-store.test.ts (신규), apps/web/package.json
감사 기준:
- 파일 첫 줄이 import 'server-only'
- readKeyPool(provider) 이 ai_provider_keys 순서대로 돌려주고 표가 비었거나 못 읽으면 META 의 기존 키 하나로 떨어짐
- 표를 못 읽어도 예외를 던지지 않음 (AI 호출이 저장소 때문에 멈추지 않음)
- 상태 기록 실패가 호출을 막지 않음 (오류를 콘솔에 남기고 진행)
- 반환값에 원문 키가 있고 로그에는 가림값만 나감
의존: I01, I02

### I05 Gemini 호출기 결선
상태: 대기
모드: 경량
범위: apps/web/lib/ai/gemini-call.ts, apps/web/lib/ai/gemini-call.test.ts
감사 기준:
- 429 를 받으면 같은 모델을 다음 키로 한 번 더 부름 (키가 두 개 이상일 때)
- 키가 하나면 지금과 같은 횟수로 끝남 (호출 수 회귀 없음)
- 모든 키가 한도면 기존 두 번째 공급자 폴백으로 내려감
- 프로세스 변수 quotaBlockedUntil 이 공급자 전체가 아니라 키 단위 상태를 따름
- pnpm test gemini-call 통과
의존: I02, I04

### I06 AI 채팅 스트림 결선
상태: 대기
모드: 경량
범위: apps/web/app/api/admin/ai-chat/stream/route.ts, apps/web/lib/ai-chat/registry.ts, apps/web/lib/ai-chat/registry.test.ts
감사 기준:
- 후보 하나가 scope 'key' 로 실패하면 같은 공급자 같은 모델을 다음 키로 재시도함
- 바깥 후보 상한 6 과 공급자당 2 가 그대로임 (키 교체가 후보 수를 늘리지 않음)
- 키를 갈아탄 사실이 사용자에게 보이는 말로 남음
- 보안: 스트림 라우트의 인증 장치가 그대로 앞에 있음 (관리자 확인 없이 부를 수 없음)
- 보안: 응답 본문과 스트림 어디에도 원문 키가 실리지 않음 (가림값과 공급자 이름만)
- pnpm test registry 통과
의존: I03, I04

### I07 RFP 관문 결선
상태: 대기
모드: 경량
범위: apps/web/lib/rfp/ai/host-caller.ts, apps/web/lib/rfp/ai/host-providers.ts, apps/web/lib/rfp/ai/host-caller.test.ts
감사 기준:
- 게이트웨이 호출자가 키 범위 실패에 다음 키로 재시도함
- 등급 관문이 키를 바꿀 때마다 다시 돌아감 (키 교체가 관문을 건너뛰지 않음)
- pnpm test 에서 rfp ai 관련 테스트 통과
의존: I03, I04

### I08 옆길 결선
상태: 대기
모드: 경량
범위: apps/web/lib/stt/provider.ts, apps/web/lib/gemini-embedding.ts, apps/web/lib/ci/ai/meta.ts, apps/web/lib/gpu/extract-helpers.ts
감사 기준:
- 회의 녹음 전사가 Groq 키 여러 개를 순서대로 시도함
- 임베딩이 Gemini 키 여러 개를 순서대로 시도함
- CI 수집과 GPU 추출이 같은 저장소를 봄 (키를 자기 방식으로 또 읽지 않음)
- pnpm tsc --noEmit 통과
의존: I04

### I09 관리자 화면 키 목록
상태: 대기
모드: 중량
범위: apps/web/app/admin/settings/AiProviderCard.tsx, apps/web/app/admin/settings/actions.ts, apps/web/lib/ai/provider-keys.ts, apps/web/lib/ai/provider-keys.test.ts, apps/web/app/admin/settings/page.tsx
감사 기준:
- 카드에서 키를 추가 삭제 순서변경 할 수 있고 줄마다 상태가 보임
- 서버액션 다섯이 전부 requireAdmin 을 지남
- 응답 어디에도 원문 키가 없음 (가림값만)
- 키가 둘 이상일 때 하나를 지우면 함께 멈추는 기능 경고가 뜨지 않고 마지막 하나를 지울 때만 뜸
- pnpm test provider-keys 통과
의존: I04

### I10 원장과 가드
상태: 대기
모드: 중량
범위: supabase/migrations/265_ai_call_key_ref.sql (신규), apps/web/lib/ai/ledger.ts, apps/web/lib/policy/ai-key-pool.test.ts (신규), apps/web/package.json
감사 기준:
- ai_llm_calls 에 key_ref 칸이 있고 호출 기록에 키 이름이 남음 (원문 키는 안 남음)
- 가드가 ai_provider_keys 를 key-store 밖에서 직접 읽는 자리 0건을 셈
- 가드가 화면 응답에 원문 키를 싣는 자리 0건을 셈
- 가드를 일부러 깨뜨려 실패를 확인하고 그 사실을 기록에 남김
- 보안: 264 마이그레이션은 표를 새로 만들지 않고 기존 ai_llm_calls 에 칸만 더함, 그 표의 RLS 상태가 전과 같음
- 보안: key_ref 에 들어가는 값이 사람이 붙인 이름이고 원문 키나 그 조각이 아님
- pnpm test 에 등재되고 실제로 돎
의존: I01, I04, I09

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-20) 최초 작성 (ins_0034)
- v0.1.1 (2026-09-20) 마이그레이션 번호 263 을 옆 세션이 먼저 가져가 264/265 로 옮김 (audit:I01)
- v0.1.2 (2026-09-20) I03 을 둘로 쪼갬: 429 가 availability 'limited' 를 남기는 것을 소비처보다 먼저 떼면 runner 의 PROVIDER_QUOTA 판정이 죽어 여러 건 돌 때 중단이 안 걸린다(v0.7.574 사고 재현). I03 은 scope 와 keyOutcome 만, I03a 가 소비처를 옮긴 뒤 availability 를 뗀다. pruneChain 은 'key' 를 'provider' 와 같게 다룬다 — 키 교체는 그 앞에서 끝난다 (audit:I03)
