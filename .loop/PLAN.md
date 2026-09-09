# PLAN newAX: AI 공급자 한곳 통합과 설정 화면 한 벌
플랜 ID: P0002
플랜 버전: v0.1.0
상태: 초안
지시: iv_0008
목표 버전: v0.9.0
작성: 2026-09-09
시작 커밋: 05425c6f

## 목표
- AI 공급자 다섯(Gemini Claude OpenAI Groq Grok)이 한 화면 한 벌의 카드로 모이고, 키 등록과 모델 고르기와 연결 확인과 폴백 순서를 그 자리에서 끝냄
- 이미 연결된 Groq 이 「음성 인식」이라는 다른 이름 뒤에 숨지 않고 AI 공급자로 드러나며, 그 키가 전사와 LLM 폴백 두 곳에 쓰인다는 사실이 화면에 적힘
- 관리자와 콘텐츠 인텔리전스와 영업 CRM 세 설정 화면이 같은 부품 같은 용어 같은 상태 표현을 씀

## 범위 밖
- 공급자별 요금 정산과 사용량 상한 강제. 지금 있는 AI 사용량 화면과 토큰 알림은 그대로 두고 건드리지 않음
- 브랜딩 테마 DB연결 Vercel Drive 한국수출입은행 YouTube 카드의 기능 변경. 골격과 용어만 공용 부품으로 맞추고 동작은 그대로
- 콘텐츠 인텔리전스 설정 레지스트리의 항목 추가 삭제. 그리는 방식만 공용 부품으로 옮김
- 음성 인식 모델 선택 기능 자체의 변경. Groq 카드 안의 한 갈래로 자리만 옮김
- 사용자별 개인 설정 신설. 지금처럼 조직 한 벌로 둠

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm --filter web test, pnpm build 전부 통과
- AI 공급자 다섯이 한 화면에서 등록 변경 해제 연결확인 모델선택이 되고, 다섯 카드가 같은 부품에서 나옴
- 기존에 저장된 Groq 키(stt_api_key)가 마이그레이션 없이 그대로 읽히고 전사와 LLM 폴백 둘 다 계속 동작
- 관리자 콘텐츠 인텔리전스 영업 CRM 세 설정 화면이 같은 공용 부품을 import 하고, 그 사실을 검사하는 정적 가드가 있음
- 연결 상태 용어가 세 화면에서 한 벌(연결됨 변경 연결 해제 연결 테스트)이고 화면에 한글 리터럴 직접 표기 없음
- 신규 테스트가 apps/web/package.json 의 test 스크립트에 등재되어 실제로 실행되고, 등재 후 총 테스트 수가 실제로 늘어남
- 루프 감사 명령 cmd_test 가 실제로 테스트를 도는 명령을 가리킴
- 사용자향 업데이트 내역 갱신

## 참조
- docs/ui-system/INVENTORY.md (부품을 먼저 찾고 없을 때만 만든다)
- docs/ui-system/GLOSSARY.md, apps/web/lib/terms (말의 SSOT)
- apps/web/app/(ci)/ci/settings/SettingsView.tsx (공용 부품의 원본이 되는 좋은 쪽)
- apps/web/app/admin/settings/integration-ui.tsx (연동 카드 용어 SSOT, 이미 있는 것)
- apps/web/lib/ai-chat/registry.ts, labels.ts, model-catalog.ts, model-status.ts
- apps/web/lib/ci/ai/meta.ts (Groq 키를 LLM 폴백으로 이미 읽는 곳)
- LOOP.md 6절 문체 규약

## 전제
- Groq 과 Grok 은 둘 다 OpenAI 호환 API 라 기존 providers/openai.ts 에 baseURL 을 인자로 주는 얇은 어댑터로 끝남
- 키는 지금처럼 org_content META 한 곳에 둔다. 저장소를 늘리면 회전 누락이 난다
- Groq 키의 META 키 이름은 stt_api_key 를 그대로 승계한다. 이름을 바꾸면 이미 연결된 키가 끊어진다
- AI 공급자 키는 조직 비밀이라 관리자 화면에 둔다. /ai/models 는 읽기 전용 뷰로 두고 키 설정으로 가는 길만 낸다
- 콘텐츠 인텔리전스 설정의 ai 그룹(응답 언어 브랜드 보이스 자동화 수준 일 한도)은 키가 아니라 정책이라 그 자리에 그대로 둔다

## 항목

### I01 AI 공급자 SSOT 를 다섯으로 넓힘
상태: 대기
모드: 경량
범위: apps/web/types/database.ts, apps/web/lib/ai-chat/labels.ts, apps/web/lib/ai-chat/registry.ts, apps/web/lib/ai-chat/registry.test.ts
감사 기준:
- node --test 로 registry.test.ts 통과
- AiChatProviderId 가 gemini claude openai groq grok 다섯이고 PROVIDER_LABELS META_KEYS DEFAULT_MODELS PROVIDER_ORDER 넷이 전부 다섯 키를 갖는 단정
- groq 의 META apiKey 키가 stt_api_key 이고, 기존에 stt_api_key 만 저장된 META 로 getAvailableProviders 를 부르면 groq 이 후보에 들어오는 단정
- grok 은 키 미등록 시 후보에서 빠지는 단정
의존: 없음

### I02 Groq 과 Grok 어댑터
상태: 대기
모드: 경량
범위: apps/web/lib/ai-chat/providers/openai.ts, 신규 apps/web/lib/ai-chat/providers/openai-compatible.ts, 신규 apps/web/lib/ai-chat/providers/groq.ts, 신규 apps/web/lib/ai-chat/providers/grok.ts, 신규 apps/web/lib/ai-chat/providers/openai-compatible.test.ts
감사 기준:
- node --test 로 openai-compatible.test.ts 통과
- 세 공급자(openai groq grok)가 같은 어댑터 팩토리에서 나오고 baseURL 만 다른 단정
- getProvider 가 다섯 id 전부에 대해 ChatProvider 를 돌려주고 어느 것도 예외를 던지지 않는 단정
- groq 과 grok 의 capabilities 가 각 공급자 실제 지원(groq vision 없음, tools 없음)과 일치하는 단정
의존: I01

### I03 모델 카탈로그와 상태에 두 공급자 반영
상태: 대기
모드: 경량
범위: apps/web/lib/ai-chat/model-catalog.ts, apps/web/lib/ai-chat/model-catalog.test.ts, apps/web/lib/ai-chat/probe-models.ts
감사 기준:
- node --test 로 model-catalog.test.ts 통과
- CURATED_MODELS 가 다섯 공급자 키를 전부 갖고 groq 과 grok 에 각각 1개 이상 모델이 있는 단정
- groq 의 whisper 계열 모델 id 가 isChatModel 에서 false 로 걸러지는 단정 (전사 전용 모델이 채팅 모델 목록에 섞이면 안 됨)
- mergeModelCatalogEntry 가 다섯 공급자 전부에 대해 빈칸 없는 엔트리를 만드는 단정
의존: I02

### I04 공급자 키 저장 창구를 한 벌로
상태: 대기
모드: 중량
범위: 신규 apps/web/lib/ai/provider-keys.ts, 신규 apps/web/lib/ai/provider-keys.test.ts, apps/web/app/admin/settings/actions.ts
감사 기준:
- node --test 로 provider-keys.test.ts 통과
- 다섯 공급자의 저장 삭제 모델저장 연결확인이 공급자 id 를 인자로 받는 함수 네 벌로 처리되고, 공급자마다 따로 쓴 서버액션이 남아 있지 않음을 검사하는 정적 가드 단정
- 키 형식 검증이 공급자별로 다르고(gsk_ sk- sk-ant- AIza xai-) 틀린 접두사를 저장하면 거부되는 단정
- 저장 성공과 실패 어느 쪽도 응답에 원문 키가 담기지 않는 단정
- groq 삭제 시 전사 기능이 함께 멈춘다는 사실이 반환 메시지에 담기는 단정
의존: I01

### I05 설정 공용 부품 신설
상태: 대기
모드: 경량
범위: 신규 apps/web/components/ui/settings/SettingsShell.tsx, 신규 apps/web/components/ui/settings/SettingRow.tsx, 신규 apps/web/components/ui/settings/SettingControl.tsx, 신규 apps/web/components/ui/settings/settings.module.css, 신규 apps/web/lib/ui/settings-contract.ts, 신규 apps/web/lib/ui/settings-contract.test.ts
감사 기준:
- node --test 로 settings-contract.test.ts 통과
- 콘텐츠 인텔리전스가 쓰던 control 8종(toggle select number time chips quiet_hours text json)을 부품이 전부 그리는 단정
- 값이 바뀌면 비제어 입력이 리마운트되도록 key 가 값에 묶여 있음을 검사하는 단정 (기본값으로 되돌렸는데 칸에 옛 값이 남던 회귀 방지)
- 출처 배지 말이 lib 상수 한 곳에서 오고 화면에 직접 적힌 곳이 없는 단정
의존: 없음

### I06 콘텐츠 인텔리전스 설정을 공용 부품으로
상태: 대기
모드: 경량
범위: apps/web/app/(ci)/ci/settings/SettingsView.tsx
감사 기준:
- pnpm tsc --noEmit 통과, pnpm lint 통과
- SettingsView 가 components/ui/settings 부품을 import 하고 자체 Control 함수가 남아 있지 않음
- 검색 탭 저장 기본값되돌리기 개요 다섯 동작이 그대로 있음 (개요 탭은 레지스트리 밖이라 부품 밖에 남김)
- 변경 전후 화면 구성 항목 수가 같음 (설정 항목이 사라지지 않았음)
의존: I05

### I07 영업 CRM 설정을 공용 부품으로
상태: 대기
모드: 경량
범위: apps/web/app/(crm)/crm/settings/SettingsCard.tsx, apps/web/app/(crm)/crm/settings/settings.module.css
감사 기준:
- pnpm tsc --noEmit 통과, pnpm lint 통과
- SettingsCard 가 components/ui/settings 부품을 import 하고 kind 별 렌더 분기가 부품 쪽 control 로 옮겨감
- CRM 고유 위젯 두 개(견적번호 형식 로고 이미지)가 부품의 확장 자리로 들어가 기능이 유지됨
- 저장 후 되읽기와 권한(ADMIN 만 편집)이 그대로임
의존: I05

### I08 세 설정 화면 동일성 가드
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/ui/settings-parity.test.ts, apps/web/package.json
감사 기준:
- node --test 로 settings-parity.test.ts 통과
- 세 설정 화면 파일이 전부 components/ui/settings 를 import 함을 검사하는 단정
- 연결 상태 용어(연결됨 변경 연결 해제 연결 테스트)를 화면 파일에 직접 적은 곳이 0건임을 검사하는 단정
- 가드를 일부러 깨뜨리면 실패하는 것을 확인한 근거를 pass notes 에 기록
의존: I06, I07

### I09 관리자 AI 탭을 공급자 한 화면으로
상태: 대기
모드: 중량
범위: 신규 apps/web/app/admin/settings/AiProviderCard.tsx, apps/web/app/admin/settings/page.tsx, 삭제 apps/web/app/admin/settings/GeminiSettings.tsx, 삭제 apps/web/app/admin/settings/ClaudeSettings.tsx, 삭제 apps/web/app/admin/settings/OpenAiSettings.tsx, 삭제 apps/web/app/admin/settings/SttSettings.tsx
감사 기준:
- pnpm tsc --noEmit 통과, pnpm lint 통과, pnpm build 통과
- AI 탭에 공급자 카드 다섯이 같은 AiProviderCard 한 벌에서 나오고, 공급자별 전용 컴포넌트 파일이 0개임
- Groq 카드가 AI 공급자 자리에 있고 그 키가 회의 전사에도 쓰인다는 사실과 해제 시 전사가 멈춘다는 사실이 카드에 적힘
- 외부 연동 탭에 음성 인식 카드가 더 이상 없고, 저장된 키가 그대로 읽힘
의존: I04, I05

### I10 기본 공급자와 폴백 순서를 그 자리에서
상태: 대기
모드: 경량
범위: 신규 apps/web/app/admin/settings/AiProviderOrder.tsx, 삭제 apps/web/app/admin/settings/AiChatDefaultProviderPicker.tsx, apps/web/lib/ai-chat/model-chain.ts, apps/web/lib/ai-chat/model-chain.test.ts
감사 기준:
- node --test 로 model-chain.test.ts 통과
- 폴백 순서가 META 한 값에서 오고 다섯 공급자 중 키가 있는 것만 순서에 들어가는 단정
- 순서를 바꾸면 model-chain 이 그 순서대로 갈아타는 단정
- 화면에서 기본 공급자와 폴백 순서를 같은 카드에서 정할 수 있음
의존: I09

### I11 AI 스튜디오 모델 화면을 새 공급자에 맞춤
상태: 대기
모드: 경량
범위: apps/web/app/(ai)/ai/load.ts, apps/web/app/(ai)/ai/models/ModelsClient.tsx
감사 기준:
- pnpm tsc --noEmit 통과, pnpm build 통과
- load.ts 의 ALL_PROVIDER_IDS 하드코딩이 registry 의 순서 상수를 쓰게 바뀜 (공급자를 늘릴 때 고칠 자리가 한 곳)
- 모델 화면 빈 상태 안내가 실제 키 설정 화면으로 가는 링크를 가짐
- 다섯 공급자가 전부 화면에 그려짐
의존: I03, I09

### I12 감사 명령 정정과 가드 등재와 업데이트 내역
상태: 대기
모드: 경량
범위: package.json, apps/web/package.json, apps/web/lib/changelog/entries.ts, .loop/loop.db
감사 기준:
- node scripts/loop.mjs config get cmd_test 가 실제로 테스트를 도는 명령을 돌려줌
- 그 명령을 돌리면 총 테스트 수가 이 플랜 시작 전보다 늘어남 (등재 전후 수를 pass notes 에 기록)
- 이 플랜에서 만든 테스트 파일이 전부 apps/web/package.json 의 test 스크립트에 등재됨
- entries.ts 에 v0.9.0 사용자향 항목이 있고 AI 공급자 다섯과 설정 화면 통일이 사용자 말로 적힘
의존: I08, I10, I11
