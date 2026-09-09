# PLAN newAX: AI 공급자 명세 한 벌과 설정 디자인 한 벌
플랜 ID: P0002
플랜 버전: v0.2.5
상태: 진행중
지시: iv_0008
목표 버전: v0.9.0
작성: 2026-09-09
시작 커밋: 05425c6f

## 목표
- AI 공급자를 늘릴 때 고칠 자리가 명세 파일 한 곳이 되고, 그 명세에서 라벨과 키와 모델과 어댑터와 화면 카드가 전부 파생됨
- 이미 연결된 Groq 과 신설하는 Grok 을 포함한 다섯 공급자가 관리자 화면 한곳에서 등록 변경 해제 연결확인 모델선택 폴백순서까지 끝남
- 관리자와 콘텐츠 인텔리전스와 영업 CRM 세 설정 화면이 같은 카드 같은 여백 같은 배지 같은 글자 크기로 보임

## 범위 밖
- 요금 정산과 사용량 상한 강제. AI 사용량 화면과 토큰 알림은 그대로 둠
- 콘텐츠 인텔리전스 설정 레지스트리의 항목 추가 삭제와 저장 규칙 변경. 보이는 방식만 바꿈
- 영업 CRM 설정 카드의 기능 변경. 예산 중복정리 데이터점검 자동화 규칙의 동작은 그대로 두고 껍데기만 맞춤
- 음성 인식 모델 선택 기능 자체의 변경. Groq 카드 안의 한 갈래로 자리만 옮김
- 사용자별 개인 설정 신설. 지금처럼 조직 한 벌로 둠
- 신규 DB 테이블. 키와 설정은 지금 쓰는 org_content META 한 곳에 그대로 둠

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm --filter web test, pnpm build 전부 통과
- 공급자를 하나 더하는 데 필요한 코드 변경이 명세 파일 한 곳임을 검사하는 단정이 있음 (여섯째 가상 공급자를 명세에만 넣고 라벨 키 기본모델 어댑터 카탈로그가 전부 따라오는 단정)
- AI 공급자 다섯이 한 화면에서 같은 카드 부품으로 그려지고 공급자별 전용 컴포넌트 파일이 0개
- 기존에 저장된 Groq 키가 마이그레이션 없이 그대로 읽히고 회의 전사와 LLM 폴백 둘 다 계속 동작
- 설정 카드의 테두리 여백 배지 보조설명이 세 화면에서 같은 클래스에서 오고, 화면 파일에 인라인 style 로 그린 상태 표시가 0건
- 세 설정 화면이 전부 공용 설정 부품을 import 함을 검사하는 정적 가드가 있고, 일부러 깨서 실패를 확인함
- 신규 테스트가 apps/web/package.json 의 test 스크립트에 등재되어 실제로 실행되고 총 테스트 수가 늘어남
- 루프 감사 명령 cmd_test 가 실제로 테스트를 도는 명령을 가리킴
- 사용자향 업데이트 내역 갱신

## 참조
- docs/ui-system/INVENTORY.md (부품을 먼저 찾고 없을 때만 만든다)
- docs/ui-system/GLOSSARY.md, apps/web/lib/terms (말의 SSOT)
- apps/web/app/globals.css 9515 부터 9680 (콘텐츠 인텔리전스 설정 디자인의 원본, 이 값을 공용으로 올린다)
- apps/web/app/admin/settings/integration-ui.tsx (연동 카드 용어 SSOT, 이미 있는 것)
- apps/web/lib/ai-chat/registry.ts, labels.ts, model-catalog.ts, model-status.ts, probe-models.ts
- apps/web/lib/ci/ai/meta.ts (Groq 키를 LLM 폴백으로 이미 읽는 곳)
- LOOP.md 6절 문체 규약

## 전제
- Groq 과 Grok 은 둘 다 OpenAI 호환 API 라 baseURL 만 다른 얇은 어댑터로 끝남
- Groq 키의 META 이름은 지금 저장된 stt_api_key 를 그대로 승계한다. 이름을 바꾸면 이미 연결된 키가 끊어진다
- AI 공급자 키는 조직 비밀이라 관리자 화면에 둔다. AI 스튜디오의 모델 화면은 읽기 전용 뷰로 두고 키 설정으로 가는 길만 낸다
- 콘텐츠 인텔리전스 설정의 ai 그룹(응답 언어 브랜드 보이스 자동화 수준 일 한도)은 키가 아니라 정책이라 그 자리에 그대로 둔다
- ci-status 와 ci-basis 는 이미 콘텐츠 인텔리전스 밖 31개 파일이 쓰고 있다. 이름이 한 화면 전용처럼 보이는 것이 영업 CRM 이 같은 뜻을 자기 CSS 로 또 적은 원인이라 개명한다

## 항목

### I01 AI 공급자 명세 한 파일
상태: 통과
모드: 경량
범위: 신규 apps/web/lib/ai/provider-catalog.ts, 신규 apps/web/lib/ai/provider-catalog.test.ts
감사 기준:
- node --test 로 provider-catalog.test.ts 통과
- 다섯 공급자(gemini claude openai groq grok)가 각각 id 라벨 META키 baseUrl 키접두사 기본모델 능력 용도설명 발급주소를 갖는 단정
- groq 의 META apiKey 이름이 stt_api_key 이고 grok 이 xai_api_key 인 단정
- 명세에 여섯째 가상 공급자를 더하면 파생 목록(라벨 순서 키맵)이 자동으로 여섯이 되는 단정
- 명세 밖에서 공급자 id 를 배열 리터럴로 하드코딩한 파일이 없음을 검사하는 단정
의존: 없음

### I02 타입과 레지스트리와 어댑터를 명세에서 파생
상태: 통과
모드: 경량
범위: apps/web/types/database.ts, apps/web/lib/ai-chat/labels.ts, apps/web/lib/ai-chat/registry.ts, apps/web/lib/ai-chat/registry.test.ts, apps/web/app/(ai)/ai/actions.ts, apps/web/app/api/admin/ai-chat/stream/route.ts, apps/web/lib/crm/ai/adapters/host.ts, apps/web/lib/ai/provider-catalog.test.ts, apps/web/lib/ai-chat/providers/openai.ts, 신규 apps/web/lib/ai-chat/providers/openai-compatible.ts, 신규 apps/web/lib/ai-chat/providers/groq.ts, 신규 apps/web/lib/ai-chat/providers/grok.ts, 신규 apps/web/lib/ai-chat/providers/openai-compatible.test.ts
감사 기준:
- node --test 로 registry.test.ts 통과
- PROVIDER_LABELS META_KEYS DEFAULT_MODELS PROVIDER_ORDER 넷이 전부 명세에서 파생되고 각자 적은 목록이 남아 있지 않은 단정
- stt_api_key 만 저장된 META 로 getAvailableProviders 를 부르면 groq 이 후보에 들어오는 단정
- 키 미등록 공급자가 후보에서 빠지는 단정
- 공급자 화이트리스트를 따로 적던 세 곳(ai/actions.ts, admin/ai-chat/stream/route.ts, crm/ai/adapters/host.ts)이 isAiProviderId 를 쓰고, provider-catalog.test.ts 의 미전환 목록에서 그 셋이 빠짐
- node --test 로 openai-compatible.test.ts 통과
- openai groq grok 셋이 같은 팩토리에서 나오고 명세의 baseUrl 만 다른 단정
- getProvider 가 다섯 id 전부에 ChatProvider 를 돌려주고 어느 것도 예외를 던지지 않는 단정
- 능력이 명세에서 오고 어댑터가 자기 값을 따로 적지 않는 단정
- 명세에 있어도 어댑터가 배선되지 않은 공급자는 후보에서 빠지는 단정 (반쯤 등록된 공급자가 사용자에게 닿지 않게)
의존: I01

### I03 Groq 과 Grok 어댑터
상태: 취소 (I02 로 병합, 타입만 넓히고 어댑터를 미루면 이미 저장된 Groq 키가 후보에 들어와 getProvider 가 던진다)
모드: 경량
범위: apps/web/lib/ai-chat/providers/openai.ts, 신규 apps/web/lib/ai-chat/providers/openai-compatible.ts, 신규 apps/web/lib/ai-chat/providers/groq.ts, 신규 apps/web/lib/ai-chat/providers/grok.ts, 신규 apps/web/lib/ai-chat/providers/openai-compatible.test.ts, apps/web/lib/ai-chat/registry.ts
감사 기준:
- node --test 로 openai-compatible.test.ts 통과
- openai groq grok 셋이 같은 팩토리에서 나오고 명세의 baseUrl 만 다른 단정
- getProvider 가 다섯 id 전부에 ChatProvider 를 돌려주고 어느 것도 예외를 던지지 않는 단정
- 능력이 명세에서 오고 어댑터가 자기 값을 따로 적지 않는 단정
의존: I01, I02

### I04 모델 카탈로그와 모델 확인을 명세 기반으로
상태: 통과
모드: 경량
범위: apps/web/lib/ai-chat/model-catalog.ts, apps/web/lib/ai-chat/model-catalog.test.ts, apps/web/lib/ai-chat/probe-models.ts
감사 기준:
- node --test 로 model-catalog.test.ts 통과
- CURATED_MODELS 가 명세의 다섯 공급자 키를 전부 갖고 groq 과 grok 에 각각 1개 이상 모델이 있는 단정
- groq 의 whisper 계열 모델 id 가 isChatModel 에서 false 인 단정 (전사 전용 모델이 채팅 목록에 섞이면 안 됨)
- mergeModelCatalogEntry 가 다섯 공급자 전부에 빈칸 없는 엔트리를 만드는 단정
- probe 가 명세의 baseUrl 로 물어보고 공급자별 분기를 따로 적지 않는 단정
의존: I01, I02

### I05 공급자 키 저장 창구 한 벌
상태: 통과
모드: 중량
범위: 신규 apps/web/lib/ai/provider-keys.ts, 신규 apps/web/lib/ai/provider-keys.test.ts, apps/web/app/admin/settings/actions.ts
감사 기준:
- node --test 로 provider-keys.test.ts 통과
- 저장 삭제 모델저장 연결확인 넷이 공급자 id 를 인자로 받는 함수 한 벌인 단정
- 공급자별 옛 서버액션이 자기 로직을 갖지 않고 새 창구를 부르기만 함을 검사하는 정적 가드 단정 (구현이 두 벌이 되면 화면마다 다른 검증을 탄다)
- 모델 목록을 공급자마다 따로 fetch 하지 않고 레지스트리의 listModels 한 창구로 받는 단정
- 키 접두사 검증이 명세에서 오고 틀린 접두사를 저장하면 거부되는 단정
- 성공과 실패 어느 쪽도 응답에 원문 키가 담기지 않는 단정
- groq 해제 시 회의 전사가 함께 멈춘다는 사실이 반환 메시지에 담기는 단정
의존: I01

### I06 설정 디자인 부품 신설
상태: 통과
모드: 경량
범위: 신규 apps/web/components/ui/settings/SettingsCard.tsx, 신규 apps/web/components/ui/settings/SettingsRow.tsx, 신규 apps/web/components/ui/settings/StatusPill.tsx, 신규 apps/web/components/ui/settings/FieldNote.tsx, 신규 apps/web/components/ui/settings/SettingsToggle.tsx, apps/web/app/globals.css
감사 기준:
- pnpm tsc --noEmit 통과, pnpm lint 통과
- 카드 테두리 여백 반경이 콘텐츠 인텔리전스 값(--border-w-2, --space-4, --radius-lg)으로 globals.css 한 곳에만 정의됨 (같은 생김새를 두 규칙으로 적지 않음 — 옛 ci- 이름은 같은 규칙의 별칭으로 두고 화면이 옮겨올 때 뺀다)
- 세 화면이 실제로 그 클래스를 쓰는지는 I08 I09 I10 에서 확인하고 I14 가드로 잠근다
- 상태 배지가 성공 경고 위험 정보 중립 다섯 뜻을 갖고 색을 화면이 고르지 않음
- 보조 설명 글자 크기와 색이 한 곳에서 옴 (지금 fs-2xs/text-faint 와 fs-2xs/text-muted 로 갈려 있음)
- node scripts/check-design-tokens.mjs 통과
의존: 없음

### I07 상태 배지와 보조 설명 클래스 개명
상태: 대기
모드: 경량
범위: apps/web/app/globals.css, apps/web/app 전역, apps/web/components 전역, 신규 apps/web/lib/ui/settings-class-guard.test.ts
감사 기준:
- node --test 로 settings-class-guard.test.ts 통과
- ci-status 를 status-pill 로, ci-basis 를 field-note 로 바꾼 뒤 옛 이름이 저장소에 0건임을 검사하는 단정
- 개명 전후 사용 파일 수가 같음 (치환에서 빠진 파일이 없음)
- pnpm build 통과
- 가드를 일부러 깨뜨려 실패를 확인한 근거를 pass notes 에 기록
의존: I06

### I08 콘텐츠 인텔리전스 설정을 공용 부품으로
상태: 대기
모드: 경량
범위: apps/web/app/(ci)/ci/settings/SettingsView.tsx
감사 기준:
- pnpm tsc --noEmit 통과, pnpm lint 통과
- SettingsView 가 components/ui/settings 부품을 import 하고 카드 골격을 자기 마크업으로 다시 그리지 않음
- 검색 탭 저장 기본값되돌리기 개요 다섯 동작이 그대로 있음
- 변경 전후 화면에 그려지는 설정 항목 수가 같음
의존: I06, I07

### I09 영업 CRM 설정을 공용 부품으로
상태: 대기
모드: 경량
범위: apps/web/app/(crm)/crm/settings/SettingsCard.tsx, apps/web/app/(crm)/crm/settings/settings.module.css, apps/web/app/(crm)/crm/settings/AutoApplyCard.tsx, apps/web/app/(crm)/crm/settings/IntegrationCard.tsx, apps/web/app/(crm)/crm/settings/DataCheckCard.tsx
감사 기준:
- pnpm tsc --noEmit 통과, pnpm lint 통과
- 다섯 카드가 공용 카드 부품을 쓰고 자체 .card .head .title .hint 규칙이 module.css 에서 사라짐
- 상태 표시가 NbBadge 가 아니라 공용 상태 배지에서 오고 뜻과 색이 다른 두 화면과 같음
- 저장 후 되읽기와 편집 권한(ADMIN 만)이 그대로임
- CRM 고유 위젯(예산 게이지 중복정리 데이터점검 자동화 규칙)의 동작이 그대로임
의존: I06, I07

### I10 관리자 설정을 공용 부품으로
상태: 대기
모드: 경량
범위: apps/web/app/admin/settings/SettingsSection.tsx, apps/web/app/admin/settings/integration-ui.tsx, apps/web/app/admin/settings/YoutubeSettings.tsx, apps/web/app/admin/settings/VercelSettings.tsx, apps/web/app/admin/settings/GoogleDriveSettings.tsx, apps/web/app/admin/settings/KoraeximSettings.tsx, apps/web/app/admin/settings/DbSettings.tsx, apps/web/app/admin/settings/BrandingSettings.tsx, apps/web/app/admin/settings/ThemeSettings.tsx, apps/web/app/admin/settings/TokenAlertSettings.tsx
감사 기준:
- pnpm tsc --noEmit 통과, pnpm lint 통과, pnpm build 통과
- 열 개 카드가 전부 공용 카드 부품을 쓰고 인라인 style 로 그린 상태 메시지가 0건
- 카드 여백이 --space-6 에서 공용값 --space-4 로 맞고 세 화면 카드가 같은 두께의 테두리를 가짐
- 각 카드의 기능(저장 해제 연결테스트 OAuth 파일선택)이 그대로임
의존: I06, I07

### I11 관리자 AI 탭을 공급자 다섯 한 화면으로
상태: 대기
모드: 중량
범위: 신규 apps/web/app/admin/settings/AiProviderCard.tsx, apps/web/app/admin/settings/page.tsx, apps/web/app/admin/settings/ModelSelectField.tsx, 삭제 apps/web/app/admin/settings/GeminiSettings.tsx, 삭제 apps/web/app/admin/settings/ClaudeSettings.tsx, 삭제 apps/web/app/admin/settings/OpenAiSettings.tsx, 삭제 apps/web/app/admin/settings/SttSettings.tsx
감사 기준:
- pnpm tsc --noEmit 통과, pnpm lint 통과, pnpm build 통과
- AI 탭의 공급자 카드가 명세를 훑어 그려지고 공급자별 전용 컴포넌트 파일이 0개
- Groq 카드가 AI 공급자 자리에 있고 그 키가 회의 전사에도 쓰인다는 사실과 해제하면 전사가 멈춘다는 사실이 카드에 적힘
- 외부 연동 탭에 음성 인식 카드가 더 이상 없고 저장된 키가 그대로 읽힘
- 각 카드에 공급자 용도 한 줄과 키 발급 주소가 명세에서 나옴
의존: I05, I06, I10

### I11a 공급자별 서버액션 철거
상태: 대기
모드: 경량
범위: apps/web/app/admin/settings/actions.ts, apps/web/lib/ai/provider-keys.test.ts
감사 기준:
- 공급자마다 따로 쓴 서버액션(saveGeminiKey deleteGeminiKey saveGeminiModel getGeminiModels checkGeminiHealth 와 Claude OpenAI Stt 대응물)이 actions.ts 에 0건임을 검사하는 정적 가드 단정
- 가드를 일부러 깨뜨려 실패를 확인한 근거를 pass notes 에 기록
- pnpm build 통과 (옛 액션을 부르던 곳이 남아 있으면 여기서 잡힌다)
의존: I11

### I12 기본 공급자와 폴백 순서를 한 카드에서
상태: 대기
모드: 경량
범위: 신규 apps/web/app/admin/settings/AiProviderOrder.tsx, 삭제 apps/web/app/admin/settings/AiChatDefaultProviderPicker.tsx, apps/web/lib/ai-chat/model-chain.ts, apps/web/lib/ai-chat/model-chain.test.ts, apps/web/app/admin/settings/actions.ts
감사 기준:
- node --test 로 model-chain.test.ts 통과
- 폴백 순서가 META 한 값에서 오고 키가 있는 공급자만 순서에 들어가는 단정
- 순서를 바꾸면 model-chain 이 그 순서대로 갈아타는 단정
- 순서에 없는 공급자는 명세 기본 순서 뒤에 붙는 단정 (새 공급자를 더해도 순서가 비지 않음)
- 화면에서 기본 공급자와 폴백 순서를 같은 카드에서 정함
의존: I02, I11

### I13 AI 스튜디오 모델 화면을 명세 기반으로
상태: 대기
모드: 경량
범위: apps/web/app/(ai)/ai/load.ts, apps/web/app/(ai)/ai/models/ModelsClient.tsx, apps/web/app/(ai)/ai/models/models.module.css
감사 기준:
- pnpm tsc --noEmit 통과, pnpm build 통과
- load.ts 의 공급자 id 하드코딩 배열이 사라지고 명세를 씀
- 다섯 공급자가 전부 화면에 그려지고 카드 골격이 공용 설정 부품과 같은 값을 씀
- 빈 상태 안내가 실제 키 설정 화면으로 가는 링크를 가짐
의존: I04, I11

### I14 동일성 가드와 감사 명령 정정과 업데이트 내역
상태: 대기
모드: 경량
범위: 신규 apps/web/lib/ui/settings-parity.test.ts, package.json, apps/web/package.json, apps/web/lib/changelog/entries.ts
감사 기준:
- node --test 로 settings-parity.test.ts 통과
- 세 설정 화면 파일이 전부 components/ui/settings 를 import 함을 검사하는 단정
- 연결 상태 용어를 화면 파일에 직접 적은 곳이 0건임을 검사하는 단정
- 가드를 일부러 깨뜨려 실패를 확인한 근거를 pass notes 에 기록
- 루프 cmd_test 가 실제로 테스트를 도는 명령을 가리키고, 이 플랜에서 만든 테스트가 전부 등재되어 총 테스트 수가 시작 전보다 늘어남 (전후 수를 pass notes 에 기록)
- entries.ts 에 v0.9.0 사용자향 항목이 있음
의존: I08, I09, I12, I13

## 변경 이력
- v0.2.1 (2026-09-09) I01 가드가 공급자 목록을 따로 적은 곳을 3개 더 찾아 I02 범위에 넣음 (audit:I01)
- v0.2.2 (2026-09-09) I02 는 어댑터 없이 감사 불가 - 타입만 넓히면 이미 저장된 Groq 키가 후보에 들어와 getProvider 가 던진다. I03 을 I02 로 병합 (audit:I02)
- v0.2.4 (2026-09-09) I05 의 서버액션 철거 가드를 I11a 로 분리 - 화면이 아직 옛 액션을 부르는 동안은 걸 수 없다 (audit:I05)
- v0.2.5 (2026-09-09) I06 의 「세 화면이 그 클래스를 씀」은 부품을 만드는 항목에서 확인 불가 - 정의가 한 곳인지만 I06 에서 보고 실제 사용은 I08 I09 I10 으로 넘김 (audit:I06)
