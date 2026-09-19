# PLAN newAX: 견적서 파일 한 장에서 견적 여러 건
플랜 ID: P0028
플랜 버전: v0.3.2
상태: 진행중
지시: ins_0029
목표 버전: v0.10.170
작성: 2026-09-19
시작 커밋: b8a7bfcf

## 목표
- 견적서 파일 한 장에 견적이 여러 건 들어 있으면 건 수만큼 읽는다 (딜 하나에 견적 여러 건은 이미 정상)
- 읽은 건을 **무엇에 쓸지는 사람이 고른다**: 새 견적, 있는 견적에 항목 붙이기, 딜 원가, 안 씀
- 시스템은 판정하지 않고 라벨로 알려만 준다 (원가인지 내용만 가져오는지는 문서가 아니라 의도라서 문서로는 알 수 없다)
- 파일에서 왔다는 사실은 표시로 남기되 보냄을 막지 않는다
- 읽기와 가져오기의 실패가 전부 그 자리에 제 문장으로 뜬다

## 범위 밖
- 올린 파일 저장 (예외: 사람이 「딜 첨부로 남기기」를 켠 경우, 기본 꺼짐)
- 견적 계산 규칙, 견적서 서식, 견적번호 형식 변경
- 말로 채우기 경로의 여러 건 지원 (말에는 대조할 근거가 없음)
- 원가 갈래·시점 체계 변경 (있는 것을 그대로 씀)

## 완료 정의
- pnpm tsc --noEmit, pnpm test, pnpm build 통과
- 화면 문자열은 전부 lib/terms 에서 옴 (화면에 한글 직접 적지 않음)
- 견적서 파일 인입 서비스에 DB 쓰기 0 유지, 레코드 생성은 사람이 누른 뒤에만
- 견적 두 건이 든 파일로 실브라우저 1회 통과, 오류 경로 최소 1개 실제 재현
- 원가는 관리자만 (cost.view·cost.edit 게이트를 새 경로가 다시 뚫지 않음)
- 새로 만든 길 어디에도 사람을 막는 잠금이 없음 (표시와 문장으로만 알림)

## 참조
- 기획 보고 https://claude.ai/code/artifact/34e4e5d8-638e-41be-b963-3eb6dc100acf
- lib/crm/services/quote-from-file.ts 머리말 (읽는 길 둘, 갈림길 하나)
- lib/crm/ai/schemas/quote-from-doc.ts 머리말 (검산 거리를 함께 받는다)
- supabase/migrations/229_crm_cost_and_line_kinds.sql (원가 갈래 10 · 시점 3 · 라인 종류 6)
- .loop/archive/P0024-*.md (v0.10.150~156 파일로 채우기)
- LOOP.md 부록 버전 규칙

## 항목

### I01 한 파일에 견적 여러 건을 담는 모양
상태: 통과
모드: 경량
범위: lib/crm/ai/schemas/quote-from-doc.ts, lib/crm/ai/schemas/quote-from-doc.test.ts, lib/crm/ai/prompts/quote-from-doc.v1.ts
감사 기준:
- pnpm --filter web exec node --test lib/crm/ai/schemas/quote-from-doc.test.ts 통과
- 건 2개 응답이 2건으로 파싱되고 건마다 title·lines·sourceTotalMinor 를 따로 가짐
- 옛 한 건 모양(최상위 lines)도 1건으로 읽힘, 상한 10건 초과는 잘린 건수를 남김
- 프롬프트에 건을 가르는 기준이 적힘 (별도 합계·별도 견적번호·안 표시·시트 경계)
의존: 없음

### I02 어디서 온 문서인지 라벨만 붙인다
상태: 통과
모드: 경량
범위: lib/crm/domain/quote-origin.ts (신규), lib/crm/domain/quote-origin.test.ts (신규), lib/crm/ai/schemas/quote-from-doc.ts
감사 기준:
- 문서 공급자 이름과 설정 quote.supplier.name 이 다르면 received, 같으면 ours, 설정이 비면 unknown
- 법인 접두·공백·대소문자 차이는 같은 이름으로 봄 (주식회사, (주))
- **라벨이 기본 도착지를 바꾸지 않음** — 어떤 값이든 기본은 「새 견적으로」 (가드 1개)
- pnpm --filter web exec node --test lib/crm/domain/quote-origin.test.ts 통과
의존: I01

### I03 서비스와 창구가 건 목록을 돌려준다
상태: 통과
모드: 경량
범위: lib/crm/services/quote-from-file.ts, lib/crm/services/quote-from-file.test.ts, app/api/crm/quotes/draft-file/route.ts
감사 기준:
- pnpm --filter web exec node --test lib/crm/services/quote-from-file.test.ts 통과
- 응답에 건 배열과 source 하나, 건마다 origin 판정이 붙음
- 서비스에 DB 쓰기 0 (기존 가드 유지)
의존: I02

### I04 검수 부품을 떼어내 두 화면이 같은 것을 쓴다
상태: 통과
모드: 경량
범위: components/ui/crm/quote-review.tsx (신규), components/ui/crm/QuoteFillPanel.tsx, lib/crm/domain/quote-reconcile.test.ts, lib/ui/quote-layout.test.ts, lib/crm/services/quote-from-file.ts, lib/crm/services/quote-from-file.test.ts
감사 기준:
- pnpm tsc --noEmit 통과
- 대조 가드 세 규칙이 새 부품 자리에서 통과 (체크한 것만 들어감·원문 조각·합계 대조)
- 같은 검수 목록 마크업이 두 파일에 없음 (가드 1개 신설)
- 화면이 응답의 quotes 를 읽고, 서비스의 옛 칸 draft 가 사라짐 (같은 값이 두 칸에 남지 않음)
의존: I03

### I05 모달은 건이 둘이면 고르게 한다
상태: 통과
모드: 경량
범위: components/ui/crm/QuoteFillPanel.tsx, components/ui/crm/quote-review.tsx, components/ui/crm/quote-panel.module.css, lib/terms/quote.ts, lib/terms/index.ts
감사 기준:
- 건 1개면 곧장 검수 화면, 2개 이상이면 고르는 목록이 먼저
- 고르는 목록은 공용 부품에 있고 화면에 두 벌이 아님 (가드 1개 신설)
- 문구는 전부 lib/terms 에서 옴, quote-layout 가드 통과
의존: I04

### I06 어디서 왔는지를 견적이 기억한다
상태: 대기
모드: 중량
범위: supabase/migrations/258_crm_quote_from_file.sql (신규), prisma/schema.prisma, lib/crm/services/quote.ts, lib/crm/services/quote-from-file-mark.test.ts (신규)
감사 기준:
- 마이그레이션이 운영 DB 에 적용되고 열 둘(fromFileAt·sourceFileName)이 생김
- 파일에서 만든 견적은 fromFileAt 이 찍히고, 한 번 고쳐 저장하면 해제됨
- **상태 전이를 막지 않음** — SENT 전이가 그대로 통과 (가드 1개, 잠금을 되살리면 깨짐)
- pnpm --filter web exec node --test lib/crm/services/quote-from-file-mark.test.ts 통과
의존: I03

### I07 건마다 어디로 보낼지 고른다
상태: 대기
모드: 경량
범위: components/ui/crm/QuoteFromFileModal.tsx (신규), components/ui/crm/QuotePanel.tsx, components/ui/crm/quote-panel.module.css, lib/terms/quote.ts
감사 기준:
- 견적 절에 파일로 가져오기 단추가 서고 빈 상태에서도 보임
- 도착지 네 길이 전부 동작: 새 견적, 있는 견적에 항목 붙이기, 딜 원가로, 안 씀
- 기본 도착지는 늘 「새 견적으로」, 건 카드는 접힌 채로 시작
- 「있는 견적에 붙이기」는 그 견적의 항목을 지우지 않고 뒤에 붙임 (version 충돌 시 문장)
- pnpm tsc --noEmit, pnpm lint 통과
의존: I06

### I08 원가로 보내는 길
상태: 대기
모드: 중량
범위: components/ui/crm/QuoteFromFileModal.tsx, app/api/crm/deals/[id]/costs/route.ts, lib/crm/services/cost.ts, lib/crm/services/quote-cost-intake.test.ts (신규)
감사 기준:
- 관리자가 아니면 원가 도착지가 아예 안 보이고 서버도 거절 (cost.edit 게이트 한 곳)
- 원가로 고른 건의 줄이 딜 원가 항목으로 생김, 같은 파일에서 판매 견적도 만들면 quoteLineId 로 이어짐
- 갈래·시점 칸은 **원가를 고른 사람에게만** 나타남, 시점 기본값은 추정(ESTIMATE)
- 「이 파일도 딜 첨부로 남기기」 칸이 있고 **기본 꺼짐**, 켠 경우에만 파일이 남음
의존: I07

### I09 마진 얹기와 우리 기본값
상태: 대기
모드: 경량
범위: components/ui/crm/QuoteFromFileModal.tsx, lib/crm/domain/quote-margin.ts (신규), lib/crm/domain/quote-margin.test.ts (신규)
감사 기준:
- 마진율을 넣으면 판매가가 계산되고 무엇을 얼마로 올렸는지 화면이 말함
- **마진 기본값 없음** — 비워 두면 원문 금액 그대로 (가드 1개)
- 목표 총액 방식은 기존 quote-target 을 그대로 씀 (계산을 두 곳에서 하지 않음)
- 단위·절사·부가세는 우리 기본값을 따름
의존: I08

### I10 오류 처리 전수
상태: 대기
모드: 경량
범위: lib/crm/ui/read-api.ts (신규), lib/crm/ui/read-api.test.ts (신규), components/ui/crm/QuoteFromFileModal.tsx, components/ui/crm/QuoteFillPanel.tsx
감사 기준:
- JSON 이 아닌 응답(504·413·HTML)에 그 상황의 문장이 뜸 (읽지 못했습니다 한 마디로 뭉개지 않음)
- 여러 건 만들기 중 일부 실패 시 성공·실패 건수와 사유가 남고 성공분은 목록에 반영됨
- 만들기 단추를 두 번 눌러도 두 벌이 안 만들어짐
- AI 공급자 한도 문장이 딜 화면 경로에서도 같은 자리에 뜸
의존: I09

### I11 실브라우저 검증
상태: 대기
모드: 경량
범위: e2e/crm-quote-fill.spec.ts, apps/web/package.json
감사 기준:
- 견적 두 건이 든 파일을 실제로 올려 두 건이 만들어지는 것을 브라우저에서 확인 (스크린샷 근거)
- 오류 경로 하나를 실제로 재현해 문장 확인
- 등재한 테스트가 pnpm test 총 수를 실제로 늘림
- AI 한도가 안 풀렸으면 그 사실과 대신 확인한 범위를 기록
의존: I10

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-19) 최초 작성 (ins_0029)
- v0.2.0 (2026-09-19) 개입 iv_0063 반영: 건 수 제한 없음(상한 10), 받은 견적서를 원가와 우리 판매가로 옮기는 항목 I02·I08·I09 추가
- v0.3.0 (2026-09-19) 개입 iv_0064 반영: 판정·잠금을 걷어내고 자율성으로. 라벨은 알림만(I02), 보냄 차단 삭제(I06), 도착지 네 길 선택(I07), 원가·첨부·마진은 전부 고르는 칸(I08·I09)
- v0.3.1 (2026-09-19) I03 이 남긴 옛 칸 draft 를 화면 전환과 같은 항목에서 지우도록 I04 범위에 서비스와 그 가드를 더함 (audit:I03)
- v0.3.2 (2026-09-19) I05 범위에 quote-review.tsx 와 quote-panel.module.css 추가 — 고르는 목록도 두 화면(모달·딜)이 함께 쓰므로 I04 가 만든 공용 부품 자리에 둔다, 화면에 적으면 I07 에서 또 적게 된다 (audit:I05)
