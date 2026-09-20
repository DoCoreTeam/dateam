# PLAN newAX: 견적서가 어느 파일에서 왔는지 말하고, 그 원본을 옆에 세워 대조한다
플랜 ID: P0038
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0048
목표 버전: v0.10.290
작성: 2026-09-20
시작 커밋: bfc545e4

## 목표
- 견적 상세가 「어느 파일에서 읽은 견적인가」를 한 줄로 말한다, 지금은 DB 에 파일 이름이 있는데도 화면 어디에도 안 나온다
- 원본과 견적서를 한 화면에 나란히 놓고 대조한다, 지금은 첨부를 내려받아 새 창으로 열어 눈으로 오가야 한다
- 기능보다 먼저 만들어진 견적(실측 2건, 2026-09-20 19:01 생성 · 기능은 21:06 반영)도 원본을 그 자리에서 붙여 대조할 수 있다

## 범위 밖
- 원본과 읽은 값을 기계가 견주어 「어느 줄이 틀렸다」를 짚는 것, 이번에는 사람이 눈으로 보는 자리를 만든다
- 매입 견적서(SUPPLY_QUOTE)의 대외비 등급을 낮추는 것, 등급을 낮추면 원가 근거가 구성원 전체에 열려 되돌릴 수 없다
- 지난 견적 2건에 원본을 대신 올려 주는 것, 파일은 사용자 손에 있고 시스템이 지어낼 수 없다
- 첨부 허용 형식을 늘리는 것(hwp·rtf·txt 원본은 지금도 첨부가 거절한다), 이번 지시의 원본은 PDF 라 별건이다

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 파일에서 읽은 견적의 상세 화면에 출처 파일 이름이 실제로 보인다
- 원본이 붙은 견적에서 「원본 대조」를 누르면 왼쪽 원본 오른쪽 견적서가 한 화면에 선다 (PDF 와 이미지 둘 다)
- 원본이 없으면 같은 자리가 「원본 올리기」로 바뀌어, 올린 즉시 대조가 된다
- 출처 줄과 대조 화면은 인쇄 PDF 이미지 어디에도 안 나간다
- 사용자 노출 문자열은 전부 lib/terms 상수 사용, 한자 0건
- 설정값은 env 추가 없이 DB 저장 + UI 관리 (해당 시)

## 참조
- LOOP.md 7절 보안 기준 (S3 값이 새지 않게, S5 응답 헤더)
- apps/web/lib/crm/domain/quote-document.ts (문서 SSOT, 고객이 읽는 것만 담는다 — 출처는 여기 넣지 않는다)
- apps/web/lib/terms/quote.ts, apps/web/lib/terms/attachment.ts (화면 문구 SSOT)
- apps/web/middleware.ts (CSP SSOT), apps/web/lib/policy/security-headers.test.ts (그 가드)

## 항목

### I01 출처를 서버가 실어 보내고 화면이 말한다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/services/quote-document.ts, apps/web/app/(crm)/crm/quotes/[id]/QuoteDocumentView.tsx, apps/web/lib/terms/quote.ts, apps/web/app/(crm)/crm/quotes/[id]/quote-document.module.css
감사 기준:
- getQuoteDocument 응답에 source: { fileName, fromFileAt } 이 붙는다, QuoteDocument «안»이 아니라 그 곁이다 (문서는 고객이 읽는 것이고 출처는 우리 사정이다)
- 파일 출처가 없는 견적은 source 가 null 이고 화면이 그 줄을 안 그린다
- QuoteDocumentView 가 머리글 아래에 출처 줄을 그리고, sourceFileName 이 있는 견적에서 그 파일 이름이 실제로 보인다
- 출처 줄이 인쇄에서 사라진다 (quote-document.module.css 의 @media print 규칙이 이 줄을 숨기고, DocSurface 미리보기 안에도 안 들어간다)
- 문구는 lib/terms 상수, 한자 0건
- 보안: 파일 이름은 이미 그 견적을 볼 수 있는 사람에게만 나가는 값이라 노출 범위가 안 넓어진다, 새 표 없음 새 창구 없음 외부 입력 없음
의존: 없음

### I02 우리가 만든 blob 만 프레임에 허용한다
상태: 통과
모드: 중량
범위: apps/web/middleware.ts, apps/web/lib/policy/security-headers.test.ts
감사 기준:
- frame-src 가 'none' 에서 'self' blob: 으로 바뀐다, 바깥 주소는 여전히 못 들어온다 (https: 를 넣지 않는다)
- frame-ancestors 'none' 과 object-src 'none' 은 그대로다 (우리를 남의 화면에 끼우는 길과 플러그인 길은 안 연다), diff 로 확인
- security-headers.test.ts 가 frame-src 의 «실제 값»을 단정한다, 이름만 찾지 않는다
- 가드를 일부러 깨뜨려(frame-src 에 https: 를 넣어) 실패하는 것을 확인하고 그 사실을 pass --notes 에 적는다
- 보안: 7절 S5, 이 판이 여는 것은 같은 출처와 우리 페이지가 만든 blob 뿐이고 그 blob 은 서명 주소를 받아 온 파일이다
의존: 없음

### I03 원본을 견적서 옆에 세운다
상태: 통과
모드: 경량
범위: apps/web/components/ui/crm/QuoteOriginalCompare.tsx (신규), apps/web/components/ui/crm/quote-original-compare.module.css (신규), apps/web/app/(crm)/crm/quotes/[id]/QuoteDocumentView.tsx, apps/web/lib/terms/quote.ts
감사 기준:
- 견적의 첨부 중 원본으로 쓸 것을 고르는 규칙이 한 곳에 있고(SUPPLY_QUOTE 중 가장 나중 것), 화면 두 곳이 각자 고르지 않는다
- 「원본 대조」를 누르면 왼쪽 원본 오른쪽 QuoteSheet 인 화면이 서고, Esc 로 닫힌다 (useEscClose 사용)
- 원본이 PDF 면 서명 주소를 받아 blob 으로 만든 뒤 프레임에 띄우고, 이미지면 img 로 띄운다, 둘 다 실제로 그려지는 것을 확인한다
- 연 blob 주소를 닫을 때 revokeObjectURL 로 거둔다 (안 거두면 견적을 여닫을 때마다 원본 한 벌이 메모리에 쌓인다)
- 인쇄에 안 나간다
- 문구는 lib/terms 상수, 한자 0건
- 보안: 첨부 읽기는 기존 /api/crm/attachments/[id]/url 창구 그대로고 새 창구를 안 연다, 서명 주소를 화면에 저장하거나 주소창에 싣지 않는다 (잠깐 열리는 주소가 기록에 남으면 그 주소로 누구나 받는다)
의존: I02

### I04 원본이 없으면 그 자리에서 올린다
상태: 통과
모드: 경량
범위: apps/web/components/ui/crm/QuoteOriginalCompare.tsx, apps/web/app/(crm)/crm/quotes/[id]/QuoteDocumentView.tsx, apps/web/lib/terms/quote.ts
감사 기준:
- 원본이 없는 견적에서는 같은 자리가 「원본 올리기」로 뜨고, 파일을 고르면 그 견적(target=QUOTE)에 붙은 뒤 곧바로 대조 화면이 열린다
- 파일에서 온 견적인데 원본이 없으면 그 사실을 한 줄로 말한다 (출처 이름만 있고 파일은 없다는 것이 사용자에게 보여야 한다, 실측 2건이 그 상태다)
- 올리기는 기존 /api/crm/attachments 창구와 기존 형식 제한을 그대로 쓴다, 제한에 걸리면 무엇이 걸렸는지 말한다
- 문구는 lib/terms 상수, 한자 0건
- 보안: 창구 재사용이라 새 창구가 없다, 종류는 기존 ATTACHMENT_KIND_SENSITIVITY 가 등급을 정한다
의존: I03

### I05 되돌아오지 않게 가드로 잠근다
상태: 대기
모드: 경량
범위: apps/web/lib/crm/ui/quote-source-surface.test.ts (신규), apps/web/package.json
감사 기준:
- 가드가 QuoteDocumentView 에서 출처 줄과 대조 단추가 실제로 «값을 받아» 그려지는지 본다, 이름만 찾으면 import 만 남아도 통과하므로 호출 자리와 인자를 함께 본다
- 가드가 출처와 대조가 인쇄에서 빠지는지 본다 (quote-document.module.css 의 인쇄 규칙)
- 가드를 일부러 깨뜨려(값 전달을 지우고 선언만 남겨) 실패하는 것을 확인하고 그 사실을 pass --notes 에 적는다
- apps/web/package.json test 스크립트에 등재하고, 등재 후 총 테스트 파일 수가 실제로 늘었는지 확인한다 (한 줄에 파일 두 개를 공백으로 붙여 쓰지 않는다)
- 보안: 테스트만 더한다, 7절 세 질문 전부 아니오
의존: I01, I03, I04

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-20) 최초 작성 (ins_0048)
