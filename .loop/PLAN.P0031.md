# PLAN newAX: AI 공급자 키를 여러 개 두고 한도에 걸린 키를 건너뛴다
플랜 ID: P0032
플랜 버전: v0.1.9
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
상태: 통과
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
상태: 통과
모드: 중량
범위: apps/web/lib/ai/key-store.ts (신규), apps/web/lib/ai/key-store-core.ts (신규), apps/web/lib/ai/key-store.test.ts (신규), apps/web/package.json
감사 기준:
- key-store.ts 첫 줄이 import 'server-only' 이고 서비스롤 클라이언트를 만드는 자리가 그 파일 안에만 있음
- readKeyPool(provider) 이 ai_provider_keys 순서대로 돌려주고 표가 비었거나 못 읽으면 META 의 기존 키 하나로 떨어짐
- 표를 못 읽어도 예외를 던지지 않음 (AI 호출이 저장소 때문에 멈추지 않음)
- 상태 기록 실패가 호출을 막지 않음 (오류를 콘솔에 남기고 진행)
- 반환값에 원문 키가 있고 로그에는 가림값만 나감, 콘솔에 실린 문자열에 원문 조각이 없음
- 보안: 표를 읽고 쓰는 질의가 key-store 밖에 없음 (원문 키가 다른 모듈로 흩어지지 않음)
- pnpm test 에 key-store 등재되고 실제로 돎
의존: I01, I02

### I05 Gemini 호출기 결선
상태: 통과
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
상태: 통과
모드: 경량
범위: apps/web/app/api/admin/ai-chat/stream/route.ts, apps/web/lib/ai/key-rotation.ts, apps/web/lib/ai-chat/registry.test.ts
감사 기준:
- 후보 하나가 scope 'key' 로 실패하면 같은 공급자 같은 모델을 다음 키로 재시도함
- 바깥 후보 상한 6 과 공급자당 2 가 그대로임 (키 교체가 후보 수를 늘리지 않음)
- 키를 갈아탄 사실이 사용자에게 보이는 말로 남음
- 보안: 스트림 라우트의 인증 장치가 그대로 앞에 있음 (관리자 확인 없이 부를 수 없음)
- 보안: 응답 본문과 스트림 어디에도 원문 키가 실리지 않음 (가림값과 공급자 이름만)
- pnpm test registry 통과
의존: I03, I04

### I07 RFP 관문 결선
상태: 통과
모드: 경량
범위: apps/web/lib/rfp/ai/host-caller.ts, apps/web/lib/rfp/ai/host-providers.ts, apps/web/lib/rfp/ai/host-caller.test.ts
감사 기준:
- 게이트웨이 호출자가 키 범위 실패에 다음 키로 재시도함
- 키 교체가 관문 **뒤에서만** 일어남: 호출자는 관문이 내준 프롬프트를 그대로 다시 보내고 가림 전 원문을 다시 만들지 않음
- 관문이 막은 모델은 키가 몇 개든 한 번도 안 불림
- 키 교체가 모델을 바꾸지 않음 (등급 판정은 모델 단위라 다른 모델이면 판정이 달라진다)
- pnpm test 에서 rfp ai 관련 테스트 통과
의존: I03, I04

### I08 키 교체 공용 부품
상태: 통과
모드: 경량
범위: apps/web/lib/ai/key-rotation.ts (신규), apps/web/lib/ai/key-rotation.test.ts (신규), apps/web/package.json
감사 기준:
- withProviderKeys 가 한도와 인증 실패에 다음 키로 넘어감
- 그 밖의 실패는 키를 안 바꾸고 그대로 올림 (네트워크 한 번 튄 것으로 키를 소진하지 않음)
- 키가 하나면 호출이 한 번이다 (교체가 헛호출을 늘리지 않음)
- 키를 다 써도 안 되면 마지막 오류를 그대로 올림 (원인이 바뀌지 않음)
- 표를 못 읽어도 부르는 쪽이 준 키 하나로 돎
- 결말 기록 실패가 호출을 막지 않음
- pnpm test 에 key-rotation 등재되고 실제로 돎
의존: I04

### I08a 옆길 결선 — 회의 녹음 전사
상태: 통과
모드: 경량
범위: apps/web/lib/stt/provider.ts, apps/web/lib/ai/key-rotation.ts, apps/web/lib/ai/key-rotation.test.ts
감사 기준:
- 회의 녹음 전사가 Groq 키 여러 개를 순서대로 시도함 (첫 키가 429 면 다음 키로 같은 녹음을 보냄)
- 키가 하나일 때 전사가 한 번만 나감 (호출 수 회귀 없음)
- 원장이 시도마다 남음 (429 를 맞았어도 녹음은 이미 그 업체로 나갔다)
- CI 수집과 GPU 추출은 gemini-call 을 타므로 키를 자기 방식으로 또 읽지 않음, 가드가 그 사실을 셈
- pnpm tsc --noEmit 통과
의존: I08

### I08b 옆길 결선 — 임베딩
상태: 통과
모드: 경량
범위: apps/web/lib/gemini-embedding.ts, apps/web/lib/ai/key-rotation.test.ts
감사 기준:
- 홑 건 임베딩이 Gemini 키 여러 개를 순서대로 시도함
- 묶음 임베딩도 같은 부품을 탐 (대량 색인이 첫 키만 두드리면 한도가 그날 다 찬다)
- 한도와 인증을 null 로 덮지 않음 (덮으면 등록된 다음 키가 한 번도 안 쓰인다)
- 가드가 그 배선을 셈
의존: I08
막힘 해제: 옆 세션이 묶음 임베딩을 커밋하면서 내 배선도 함께 실려 나갔음 (v0.10.226)
      배선은 HEAD 에 있고 이 항목은 그것을 가드로 못 박는 일만 남음

### I09 키 목록 규칙과 저장소
상태: 통과
모드: 중량
범위: apps/web/lib/ai/key-store.ts, apps/web/lib/ai/key-store-core.ts, apps/web/lib/ai/provider-keys.ts, apps/web/lib/ai/provider-keys.test.ts
감사 기준:
- listKeys 가 꺼진 줄과 인증이 깨진 줄까지 **전부** 돌려줌 (고르는 목록과 보는 목록은 다른 질문이다)
- 화면용 줄에 원문 키가 없고 가림값과 상태 문구만 있음
- 줄마다 상태가 하나로 정해짐: 쓸 수 있음 · 쉬는 중 · 인증 깨짐 · 꺼짐
- 키가 둘 이상이면 하나를 지워도 함께 멈추는 기능 경고가 안 뜨고, 마지막 하나를 지울 때만 뜸
- 줄을 더하거나 지우거나 순서를 바꾸면 META 의 기존 키 칸이 첫 줄과 같아짐 (그 칸을 직접 읽는 자리가 아직 마흔이다)
- 보안: 표를 읽고 쓰는 질의가 key-store 밖에 없음 (I04 가드가 계속 0 을 셈)
- pnpm test provider-keys 통과
의존: I04

### I09a 관리자 화면 키 목록
상태: 통과
모드: 중량
범위: apps/web/app/admin/settings/AiProviderCard.tsx, apps/web/app/admin/settings/actions.ts, apps/web/app/admin/settings/page.tsx
감사 기준:
- 카드에서 키를 추가 삭제 순서변경 할 수 있고 줄마다 상태가 보임
- 새 서버액션이 전부 requireAdmin 을 지남
- 응답 어디에도 원문 키가 없음 (가림값만)
- 화면 문자열이 하드코딩이 아니라 규칙 모듈이 준 문구임 (같은 상태가 화면마다 다른 말이 되지 않게)
- pnpm tsc --noEmit 통과
의존: I09

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
- v0.1.3 (2026-09-20) I04 을 두 파일로 나눔: node --test 는 server-only 를 못 읽는다(Next 가 빌드 때 별칭으로 붙이는 것이라 패키지가 없음). 한 파일로 두면 감사 기준을 소스 훑기로만 볼 수 있어 가드가 안 된다. 저장소 전례(org-scope.ts / org-scope-pure.ts)대로 서비스롤 배선만 server-only 에 두고 규칙은 core 로 뺀다. 원문 키가 흩어지지 않는지 세는 보안 줄과 등재 줄도 추가 (audit:I04)
- v0.1.4 (2026-09-20) I08 을 둘로 쪼갬. ①같은 키 교체 로직이 STT·임베딩·호출기 세 곳에 필요해 공용 부품으로 뺀다(재사용·단일구현 정책). ②원래 범위의 넷 중 ci/ai/meta.ts 와 gpu/extract-helpers.ts 는 고칠 것이 없다 - 둘 다 gemini-call 을 타므로 I05 로 이미 같은 저장소를 본다. 코드를 안 고치는 대신 「자기 방식으로 또 읽지 않는다」를 가드로 못 박는다 (audit:I08)
- v0.1.5 (2026-09-20) I08a 범위에 key-rotation.ts 추가. 전사는 실패를 SttError 로 이미 분류해 던지는데 그 문구에 429 나 401 이 안 들어 있어 classifyProviderError 가 못 읽는다 - 한글 안내문이기 때문. 부르는 쪽이 자기 오류 형을 결말로 옮길 수 있게 outcomeOf 를 옵션으로 연다 (audit:I08a)
- v0.1.6 (2026-09-20) I08a 에서 임베딩을 떼어 I08b 로 미룸. 옆 세션이 같은 파일에 묶음 임베딩(embedTexts)과 guardedVectors 를 만드는 중인데 둘 다 아직 HEAD 에 없다. 그 파일을 지금 커밋하면 없는 함수를 부르는 코드가 들어가 빌드가 깨진다. 배선은 작업 트리에 이미 있고 tsc 도 통과하므로 그 판이 커밋된 뒤에 얹는다. 남의 미완 작업을 대신 끝내지도, 되돌리지도 않는다 (audit:I08a)
- v0.1.7 (2026-09-20) I06 범위에서 registry.ts 를 빼고 key-rotation.ts 를 넣음. 레지스트리는 META 에서 키 하나를 읽는 자리인데 그 값은 그대로 첫 키로 쓰이므로 고칠 것이 없다. 대신 키를 갈아탄 사실을 화면에 말하려면 「다음 키로 넘어가기 직전」을 알 수 있어야 하는데 공용 부품에 그 자리가 없다 - record 로 대신하면 마지막 키가 실패할 때도 「다른 키로 다시 답합니다」를 찍고 끝난다. onSwitch 를 연다 (audit:I06)
- v0.1.8 (2026-09-20) I07 기준 수정. 「등급 관문이 키를 바꿀 때마다 다시 돌아감」은 잴 수 없는 문장이었다 - 관문은 모델과 문서 등급으로 판정하므로 키가 바뀌어도 답이 같다. 다시 돌려도 no-op 이라 통과해도 아무것도 보증하지 않는다. 실제로 지켜야 하는 것은 「관문을 건너뛰지 않는다」이고 그것은 셋으로 잴 수 있다: 교체가 관문 뒤에서만 일어나는가, 관문이 막은 모델은 한 번도 안 불리는가, 교체가 모델을 바꾸지 않는가 (audit:I07)
- v0.1.9 (2026-09-20) I09 을 둘로 쪼갬. 표 CRUD 는 I04 가드 때문에 key-store 안에만 둘 수 있고, 화면은 꺼진 줄과 인증이 깨진 줄까지 봐야 해서 readKeyPool(고르는 목록)로는 안 된다. 규칙과 저장소를 먼저 세우고 화면을 그 위에 올린다. 일곱 파일을 한 번에 감사할 수 없어 넷과 셋으로 나눔. 그리고 META 의 기존 키 칸을 첫 줄과 맞추는 규칙을 기준에 넣음 - 그 칸을 직접 읽는 자리가 아직 마흔이라 표만 고치면 그 마흔이 옛 키로 돈다 (audit:I09)
