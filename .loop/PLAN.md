# PLAN newAX: 견적서를 파일로 채우고 항목 줄 손잡이를 제자리에
플랜 ID: P0024
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0026
목표 버전: v0.10.149
작성: 2026-09-18
시작 커밋: aa5bb60a

## 목표
- 이미 만들어 둔 견적서를 파일(PDF·엑셀·워드·한글·이미지)로 올리면 우리 양식의 항목으로 옮겨 준다
- 옮긴 값은 **넣기 전에 원문과 대조**한다 — 견적은 고객에게 나가는 문서라 조용히 들어가면 안 된다
- 항목 줄 위 단추 넷이 화면 폭에 흩어져 있던 것을 성격대로 묶어 오른쪽에 세운다

## 범위 밖
- 올린 파일 자체를 저장하는 것 (읽고 버린다, 딜 첨부는 이미 따로 있음)
- 견적서 항목 밖의 값 자동 채우기 (공급자 정보·거래 조건은 우리 설정이 진실이다)
- 한글(hwp) 전용 표 복원 고도화 — 기존 rfp 파서가 읽는 만큼만 쓴다
- GPU 통합입력·RFP 화면 (같은 파서를 쓰지만 그쪽 화면은 건드리지 않는다)

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 새 테스트는 apps/web/package.json test 스크립트에 등재되어 실제로 돈다
- 화면 문자열은 전부 lib/terms 를 거친다 (화면에 한글 직접 금지)
- 파일로 채운 값은 **사람이 확인을 누르기 전에는 폼에 들어가지 않는다**
- 문서에 적힌 합계와 우리가 계산한 합계가 다르면 화면이 그 차액을 말한다
- 설정값 추가 없음 (env 추가 금지)

## 참조
- LOOP.md 부록 버전 규칙 (여섯 파일·patch 만 올림)
- apps/web/lib/rfp/parse/index.ts — 파일 → IR 파서 라우터 (재사용, 새로 만들지 않음)
- apps/web/lib/ai/gemini-call.ts — 멀티모달 parts (이미지 경로)
- apps/web/lib/crm/ai/runner.ts — AI 호출 기록·예산·파싱 재시도 (모든 AI 는 여기를 지난다)
- apps/web/lib/ui/quote-layout.test.ts — 견적 화면 배치 가드 (여기에 단추 배치 규칙을 더한다)

## 항목

### I01 항목 줄 단추를 성격대로 묶는다
상태: 통과
모드: 경량
범위:
- apps/web/components/ui/crm/quote-panel.module.css
- apps/web/components/ui/crm/QuoteEditorModal.tsx
- apps/web/lib/ui/quote-layout.test.ts
감사 기준:
- .linesHead 가 space-between 로 자식을 흩지 않는다: quote-panel.module.css 에서 `.linesHead` 에 `justify-content: space-between` 이 없다
- 액션이 한 덩어리다: `.lineActions` 규칙이 있고 `margin-left: auto` 와 `flex-wrap: wrap` 을 갖는다
- 채우기(말로·파일로)와 추가(묶음·항목)가 구분자로 나뉜다: `.actionSep` 규칙이 있고 모달이 `styles.actionSep` 를 쓴다
- 「항목 추가」만 secondary 이고 나머지 셋은 ghost: 모달에서 `variant="secondary"` 가 addLine 단추에만 붙는다
- pnpm test 로 lib/ui/quote-layout.test.ts 통과, 규칙을 일부러 지우면 실패하는 것을 확인
의존: 없음

### I02 문서를 표가 살아 있는 글로 옮긴다
상태: 통과
모드: 경량
범위:
- apps/web/lib/crm/services/quote-source-text.ts (신규)
- apps/web/lib/crm/services/quote-source-text.test.ts (신규)
- apps/web/package.json (테스트 등재)
감사 기준:
- IrDocument 의 표가 셀 경계를 지킨 글로 나온다: 2행 3열 표를 넣으면 행마다 ` | ` 로 이어진 줄이 나온다 (평문으로 뭉개지 않는다)
- 글자 수 상한을 넘으면 뒤를 자르고 잘렸다는 사실을 함께 돌려준다 (조용히 버리지 않는다)
- 머리말·꼬리말 블록은 뺀다 — 쪽마다 반복돼 항목으로 읽히면 유령 줄이 생긴다
- pnpm test 실행 후 총 테스트 수가 실제로 늘었다
의존: 없음

### I03 견적서 문서 읽기 스키마와 프롬프트
상태: 통과
모드: 경량
범위:
- apps/web/lib/crm/ai/schemas/quote-from-doc.ts (신규)
- apps/web/lib/crm/ai/schemas/quote-from-doc.test.ts (신규)
- apps/web/lib/crm/ai/prompts/quote-from-doc.v1.ts (신규)
- apps/web/package.json (테스트 등재)
감사 기준:
- 줄마다 원문 조각(sourceText)을 담는다 — 사람이 대조할 수 없는 값은 검수가 안 된다
- 문서에 적힌 합계(sourceTotalMinor)를 따로 받는다 — 우리 계산과 대조할 근거다
- 단가를 못 읽으면 null 이고 스키마가 통과한다 (0 으로 눕히지 않는다: 0원 견적이 조용히 생긴다)
- 「1억 2천만원」류 한국식 표기를 정수로 푼다 (quote-draft 스키마의 amount 와 같은 규칙)
- 모르는 kind 는 거절한다 (QUANTITY 로 눕히지 않는다)
- pnpm test 통과
의존: I02

### I04 파일을 받아 견적 초안을 돌려주는 창구
상태: 통과
모드: 중량
범위:
- apps/web/lib/crm/services/quote-from-file.ts (신규)
- apps/web/lib/crm/services/quote-from-file.test.ts (신규)
- apps/web/app/api/crm/quotes/draft-file/route.ts (신규)
- apps/web/package.json (테스트 등재)
감사 기준:
- 종류별 갈림길이 하나다: 이미지면 멀티모달 parts, 그 밖은 rfp parseFile → I02 의 글 (같은 판단을 두 곳에서 하지 않는다)
- 크기·종류 상한이 있고 넘으면 사람이 읽을 이유와 함께 거절한다 (파일 크기, 허용 확장자 목록)
- 레코드를 만들지 않는다: 서비스가 db 쓰기를 하지 않는다 (초안만 돌려준다)
- 권한은 MEMBER, withCrmApi 를 지난다
- 모든 AI 호출이 runAi 를 지난다 (기록·예산·재시도)
- pnpm test 통과
의존: I03

### I05 채우기 패널을 따로 세우고 파일 길을 배선한다
상태: 통과
모드: 경량
범위:
- apps/web/components/ui/crm/QuoteFillPanel.tsx (신규)
- apps/web/components/ui/crm/QuoteEditorModal.tsx
- apps/web/components/ui/crm/quote-panel.module.css
- apps/web/lib/terms/quote.ts
감사 기준:
- 모달이 800줄 아래로 내려온다 (말로 채우기 UI 가 패널로 이관됨)
- 「말로 채우기」가 옮긴 뒤에도 그대로 동작한다: 총액 맞추기 알림·못 알아본 말 표시가 유지된다
- 파일 고르기가 pdf·xlsx·docx·pptx·hwp·hwpx·csv·txt·png·jpg 를 받는다
- 화면에 한글 직접 쓰지 않는다: 새 문자열은 lib/terms/quote.ts 에서 온다
- pnpm tsc --noEmit 통과
의존: I04

### I06 넣기 전에 원문과 대조한다
상태: 통과
모드: 경량
범위:
- apps/web/components/ui/crm/QuoteFillPanel.tsx
- apps/web/components/ui/crm/quote-panel.module.css
- apps/web/lib/crm/domain/quote-reconcile.ts (신규)
- apps/web/lib/crm/domain/quote-reconcile.test.ts (신규)
- apps/web/package.json (테스트 등재)
감사 기준:
- 읽은 항목이 체크 목록으로 뜨고, 체크한 것만 폼에 들어간다 (자동 반영 없음)
- 문서 합계와 우리 합계의 차액을 계산하는 순수 함수가 있고, 0 이 아니면 경고 등급을 준다
- 단가를 못 읽은 줄은 기본 체크 해제로 뜬다 (빈 단가가 0원으로 들어가는 사고를 막는다)
- 줄마다 원문 조각이 함께 보인다
- 기존 항목을 지우지 않는다: 이미 있는 항목 뒤에 붙는다 (빈 줄 하나뿐일 때만 갈아 끼움)
- pnpm test 통과
의존: I05

### I07 실화면 확인과 발행
상태: 대기
모드: 경량
범위:
- apps/web/lib/changelog/entries.ts
- package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md
감사 기준:
- 실브라우저에서 딜 상세 → 새 견적 → 단추 넷이 오른쪽에 묶여 뜬다 (스크린샷)
- 실브라우저에서 파일을 올려 검수 목록이 뜨고, 체크한 항목만 폼에 들어간다 (스크린샷)
- 버전 여섯 파일이 함께 올랐다: pnpm test 의 policy-sync·version-rule 통과
- entries.ts 맨 위에 이번 버전 블록이 있다
의존: I06

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-18) 최초 작성 (ins_0026)
