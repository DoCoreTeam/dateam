# PLAN newAX: 전 서비스 관문 적용과 패키지 출시

플랜 ID: P0016
플랜 버전: v0.2.0
상태: 진행중
지시: ins_0012
목표 버전: v0.10.84
작성: 2026-09-16
시작 커밋: 6549dbae

## 목표
- AI 를 부르는 모든 길이 관문을 지난다, 기준을 만들어 두고 일부만 적용한 상태를 끝낸다
- 확신을 그리는 화면이 전부 공용 규칙을 지난다
- 패키지 넷을 저장소 밖에서도 쓸 수 있게 포장하고 쓰는 법을 문서로 남긴다

## 범위 밖
- npm 에 실제로 올리는 일, 그것은 계정과 이름을 정하는 사람의 일이다
- 화면 겉모양을 바꾸는 일, 값을 읽는 규칙만 통일한다

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 벤더를 직접 부르는 길이 관문 안쪽 한 자리만 남음
- 확신을 그리는 화면이 전부 공용 규칙을 지남
- 패키지 넷이 이름과 판과 라이선스와 읽을 문서를 갖춤
- 쓰는 법 문서 하나로 새 서비스가 이 층을 붙일 수 있음

## 참조
- docs/2026-09-10-ai-common-layer/README.md 3절 패키지 경계, 9단계
- apps/web/lib/ai/guarded-gemini.ts (관문을 지나는 유일한 호출 자리)
- apps/web/lib/policy/vendor-call-baseline.json (남은 24곳)

## 항목

### I01 공통 gemini 모듈 일곱을 관문으로
상태: 통과
모드: 중량
범위: apps/web/lib/gemini-refine.ts, apps/web/lib/gemini-content-edit.ts, apps/web/lib/gemini-suggest-tasks.ts, apps/web/lib/gemini-suggest-projects.ts, apps/web/lib/gemini-embedding.ts, apps/web/lib/daily-prompt-governance.ts, apps/web/lib/policy/vendor-call-baseline.json
감사 기준:
- 일곱이 guardedGeminiText 를 지나거나, 임베딩처럼 글자 생성이 아닌 것은 사유를 적고 기준선에 남김
- 원장을 받는 자리를 만들되 안 주면 호출을 막지 않음
- 기존 시험이 그대로 통과
- 기준선이 그만큼 내려감
의존: 없음

### I02 라우트 다섯을 관문으로
상태: 통과
모드: 중량
범위: apps/web/app/api/ai/analyze-work/route.ts, apps/web/app/api/daily/flow-reason/route.ts, apps/web/app/(member)/calendar/actions.ts, apps/web/app/api/reports/aggregate-stream/route.ts, apps/web/app/api/pricing/gpu/db-chat/route.ts, apps/web/lib/policy/vendor-call-baseline.json
감사 기준:
- 글자를 주고받는 라우트가 관문을 지남
- 흘려보내는 길(stream)은 관문이 흘려보내기를 못 다루면 사유를 적고 기준선에 남김
- 기존 시험 통과, 기준선이 그만큼 내려감
의존: I01
### I03 GPU 와 콘텐츠와 AI 스튜디오
상태: 통과
모드: 중량
범위: apps/web/lib/gpu/extract-helpers.ts, apps/web/app/api/pricing/gpu/specs/generate/route.ts, apps/web/app/api/pricing/gpu/quotes/[id]/reanalyze/route.ts, apps/web/lib/ci/ai/gemini.ts, apps/web/lib/ci/ai/creative-server.ts, apps/web/lib/policy/vendor-call-baseline.json
감사 기준:
- 각 길이 관문을 지나거나 사유와 함께 남음
- 남기는 것은 「왜 못 지나는가」를 한 줄로 적음, 사유 없이 남기지 않음
- 기존 시험 통과, 기준선이 그만큼 내려감
의존: I02

### I03a 남은 여섯을 관문으로
상태: 통과
모드: 중량
범위: apps/web/lib/gemini-lead.ts, apps/web/lib/crm/services/card-read.ts, apps/web/lib/stt/provider.ts, apps/web/lib/ai-chat/providers/gemini.ts, apps/web/lib/ai/gemini-call.ts, apps/web/lib/ai/fallback-text.ts, apps/web/lib/policy/vendor-call-baseline.json
감사 기준:
- 여섯이 관문을 지나거나, 사슬과 폴백을 스스로 들어 관문 안쪽인 것은 그 사유를 기준선에 적음
- 벤더 주소를 아직 들고 있으면서 사유가 없는 파일이 0개
- 기존 시험 통과, 기준선이 그만큼 내려감
의존: I03

### I04 확신을 그리는 화면 열셋
상태: 통과
모드: 경량
범위: apps/web/lib/policy/ai-component-baseline.json, apps/web/lib/policy/ai-component-baseline.test.ts, apps/web/app/(crm)/crm/inbox/SuggestionCard.tsx, apps/web/app/(member)/daily/AutolinkSection.tsx, apps/web/app/(member)/dept-tasks/DeptTaskSuggestPanel.tsx, apps/web/app/(member)/meeting-notes/ExtractConfirmModal.tsx
감사 기준:
- 실측 정정: 스물다섯 중 실제로 그리는 것은 열셋, 나머지는 타입이나 전달만 함
- 판정을 실제로 그리는가로 바꾸고 기준선을 다시 잼
- 숫자로 그리는 화면이 confidenceView 를 지남, 문턱은 화면 몫으로 둠
- 화면에 보이는 숫자가 안 바뀜, 기존 시험 통과
의존: I03

### I05 패키지 넷을 출시 모양으로
상태: 통과
모드: 중량
범위: packages/ai-core/package.json, packages/ai-gateway/package.json, packages/ai-providers/package.json, packages/ai-react/package.json, packages/LICENSE (신규)
감사 기준:
- private 을 풀고 판 번호와 라이선스와 설명과 저장소 주소를 넣음
- 서로를 참조하는 자리가 workspace 표기와 실제 판을 함께 갖게 함
- 패키지마다 무엇을 하는 것인지 한 줄이 package.json 에 있음
- 앱이 그대로 돌아감, 세 명령 통과
의존: I04

### I06 쓰는 법 문서
상태: 통과
모드: 경량
범위: packages/README.md (신규), packages/ai-core/README.md (신규), packages/ai-gateway/README.md (신규), packages/ai-providers/README.md (신규), packages/ai-react/README.md (신규)
감사 기준:
- 새 서비스가 이 층을 붙이는 순서를 문서 하나로 따라갈 수 있음
- 패키지마다 무엇을 주고 무엇을 안 주는지, 쓰는 쪽이 무엇을 줘야 하는지 적음
- 말은 쓰는 쪽이 준다는 규칙과 그 이유를 적음
- 예제 코드가 실제 수출 이름과 맞는지 가드로 확인
- 한자 0건 이모지 0건 가운뎃점 0건
의존: I05

### I06a 개발자센터에 AI 공통층 메뉴
상태: 대기
모드: 경량
범위: apps/web/lib/api-docs/ai-layer.ts (신규), apps/web/app/develop/AiLayerSection.tsx (신규), apps/web/app/develop/page.tsx, apps/web/lib/policy/ai-layer-docs-guard.test.ts (신규), apps/web/package.json
감사 기준:
- /develop 왼쪽 목록에 「AI 공통층」 묶음이 뜨고 소개·붙이는 순서·능력·계약을 읽을 수 있음
- 화면이 문서를 손으로 들지 않음, 목록과 예제는 ai-layer.ts 한 곳에서 옴
- 예제가 드는 수출 이름이 실제 패키지에 있는지 가드가 확인, 일부러 깨서 확인
- 화면 한글 직접 금지 규칙 위반 0건, 기존 시험 통과
의존: I06

### I07 문서와 코드가 갈리지 않게 하는 가드
상태: 대기
모드: 경량
범위: apps/web/lib/policy/package-docs-guard.test.ts (신규), apps/web/package.json
감사 기준:
- 문서가 드는 수출 이름이 실제로 있는지 확인, 없으면 실패
- 패키지마다 읽을 문서가 있는지 확인
- 일부러 깨서 둘 다 확인
- 등재 후 총 테스트 수 증가 확인
의존: I06

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-16) 최초 작성 (ins_0012)
- v0.1.1 (2026-09-16) I02 제목이 아홉인데 범위는 다섯이었다. GPU 넷은 I03 에 있어 제목을 실제 범위에 맞춘다 (audit:I02)
- v0.1.2 (2026-09-17) 벤더 주소를 아직 들고 있는 여섯을 위해 I03a 삽입. 기준 적용 대상에서 빼 둘 이유가 없다 (audit:I03)
- v0.2.0 (2026-09-17) 사용자 지시: 개발자센터에 패키지 소개와 셋업을 메뉴로 넣는다. I06a 삽입 (ins_0018)
