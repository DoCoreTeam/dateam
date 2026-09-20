# PLAN newAX: 견적서가 원본만큼 자세해지고, 건마다 자기 원본을 갖는다
플랜 ID: P0040
플랜 버전: v0.1.1
상태: 진행중
지시: ins_0050
목표 버전: v0.10.316
작성: 2026-09-20
시작 커밋: 659a2866

## 목표
- 파일로 만든 견적서가 원본의 구성 줄과 금액 없는 행까지 그대로 담는다
- 한 파일에 견적이 여럿이어도 견적마다 자기 쪽 조각을 갖고, 대조를 열면 그 자리가 바로 보인다
- 상한과 켜고 끄기는 코드에 안 박고 설정 화면에서 바꾼다

## 범위 밖
- 구성 줄을 항목으로 쪼개 값을 매기는 일 (원본이 안 매긴 값을 우리가 만들지 않는다)
- 구성 줄에서 제품을 알아내 제품 목록과 잇는 일
- 금액 계산과 합계 규칙 변경
- 원본 조각에 사람이 직접 그리는 주석 기능

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 이 플랜에서 만든 값이 전부 화면에서 쓰인다 (선언만 되고 소비 코드 0 인 자리가 없다)
- 새 상한과 켜고 끄기는 전부 설정 화면에 뜨고, 코드의 숫자는 fallback 한 곳뿐이다
- 사용자 노출 문자열은 전부 lib/terms 상수
- 골든 원문(광양분소 견적서 표 모양)을 읽으면 항목 7건 + 구성 13줄이 나온다

## 참조
- 기획 보고 (증거·원인·계획·화면) https://claude.ai/code/artifact/3195599b-82a0-4b65-b011-f8cf3e32318c
- lib/crm/ai/schemas/quote-from-doc.ts 머리말 (읽기 계약)
- lib/crm/services/setting.ts 머리말 (설정 두 층)
- LOOP.md 7절 보안 기준

## 항목

### I01 원문을 펼 때 쪽을 심는다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/services/quote-source-text.ts, apps/web/lib/crm/services/quote-source-text.test.ts
감사 기준:
- 쪽이 2 인 블록 앞에 쪽 표시 줄이 한 번만 들어가는 단정이 있다 (같은 쪽이 이어지면 다시 안 붙는다)
- pageNo 가 전부 null 인 문서는 표시 줄이 0 개인 단정이 있다 (평문·한글 파서 경로가 안 깨진다)
- 상한에 걸려 자를 때 표시 줄도 길이에 포함되는 단정이 있다
- 보안: 순수 변환만 바꾼다, 새 데이터·새 창구·외부 입력 없음 (7절 세 질문 전부 아니오)
의존: 없음

### I02 읽기 상한과 켜고 끄기를 설정으로 뺀다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/services/setting.ts, apps/web/lib/crm/services/quote-import-config.ts (신규), apps/web/lib/crm/services/quote-import-config.test.ts (신규), apps/web/lib/terms/quote.ts, apps/web/lib/crm/domain/setting-group.ts, apps/web/lib/crm/domain/settings-tab.ts, apps/web/app/(crm)/crm/settings/page.tsx
감사 기준:
- 설정 키 다섯이 SETTING_DEFS 에 있고 기본값이 지금 코드 상수와 같은 단정이 있다 (maxComponentLines=40, maxLines=200, maxChars=12000, snapshot=on, printComponents=expand)
- 새 카드가 설정 화면 견적 탭에 실제로 서는 단정이 있다 (묶음·카드 목록·화면 셋이 같은 이름을 쓴다)
- readQuoteImportConfig 가 설정이 하나도 없을 때 fallback 다섯을 그대로 돌려주는 단정이 있다
- 숫자 설정에 0 이나 글자를 넣으면 fallback 으로 되돌아가는 단정이 있다 (빈 값이 상한이 되면 읽기가 통째로 0 건이 된다)
- pnpm --filter web exec node --test lib/crm/services/quote-import-config.test.ts 통과
- 보안: 설정은 기존 창구(resolveSetting)만 쓴다, env 추가 없음, 비밀 아님
의존: 없음

### I03 읽는 모양에 구성·쪽·묶음을 더한다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/ai/schemas/quote-from-doc.ts, apps/web/lib/crm/ai/schemas/quote-from-doc.test.ts, apps/web/lib/crm/ai/schemas/quote-draft.ts
감사 기준:
- 항목에 components(줄 목록)·sourcePage·groupLabel 이 생기고, 건에 pageStart·pageEnd 가 생기는 단정이 있다
- 규격 300자를 넘겨도 문서 전체가 실패하지 않고 잘리는 단정이 있다 (지금은 too_big 으로 문서가 통째로 죽는다, 2026-09-20 실측)
- 구성 줄이 상한을 넘으면 잘린 수를 droppedComponents 로 세는 단정이 있다 (조용히 안 버린다)
- 상한이 인자로 들어오고 스키마 안에 숫자가 안 박혀 있는 단정이 있다
- 보안: 파싱 관용은 이 파일 한 곳, 새 창구 없음
의존: I02

### I04 읽기 지시를 뒤집는다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/ai/prompts/quote-from-doc.v1.ts, apps/web/lib/crm/ai/prompts/quote-from-doc-prompt.test.ts (신규)
감사 기준:
- 프롬프트에 규칙 넷이 들어 있는 단정이 있다 (이어진 행은 위 항목의 구성 / 금액 없는 행도 항목 / 쪽 표시를 그대로 옮김 / 묶음 보존)
- 「품목이 적힌 행만 항목이다」 문장이 사라진 단정이 있다 (남겨 두면 두 지시가 싸운다)
- 프롬프트 판이 v1.2.0 으로 오른 단정이 있다
- 보안: 프롬프트에 비밀·내부 구조를 싣지 않는다
의존: I03

### I05 읽은 구성을 검수 목록과 저장까지 나른다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/services/quote-from-file.ts, apps/web/components/ui/crm/quote-review.tsx, apps/web/components/ui/crm/quote-draft-shape.ts, apps/web/lib/crm/ui/quote-source-surface.test.ts
감사 기준:
- 검수 목록이 항목마다 구성 줄 수를 보여 주고 접었다 펼 수 있는 단정이 있다
- 고른 항목을 폼으로 옮길 때 구성이 규격 아래 줄바꿈으로 붙는 단정이 있다
- 상한에 걸려 잘린 구성이 있으면 화면이 그 수를 말하는 단정이 있다
- 보안: 저장 창구는 기존 견적 창구 그대로, AI 가 직접 저장하지 않는다 (추출·제안형)
의존: I03

### I06 편집 칸이 여러 줄이 된다
상태: 통과
모드: 경량
범위: apps/web/components/ui/crm/QuoteEditorModal.tsx, apps/web/components/ui/crm/quote-panel.module.css, apps/web/lib/ui/form-field-contract.test.ts
감사 기준:
- 규격 칸이 textarea 이고 input-field 클래스를 다는 단정이 있다 (지금은 한 줄 input, QuoteEditorModal.tsx:553)
- 여러 줄을 넣고 저장하면 줄바꿈이 살아 남는 단정이 있다
- pnpm --filter web exec node --test lib/ui/form-field-contract.test.ts 통과
- 보안: 화면 입력만 바뀐다, 저장 경로 무변경
의존: 없음

### I07 인쇄와 엑셀이 구성을 그대로 낸다
상태: 통과
모드: 경량
범위: apps/web/app/(crm)/crm/quotes/[id]/QuoteSheet.tsx, apps/web/app/(crm)/crm/quotes/[id]/quote-document.module.css, apps/web/lib/crm/services/quote-xlsx.ts, apps/web/lib/crm/domain/quote-document.ts
감사 기준:
- 규격 자리가 줄바꿈을 살리는 단정이 있다 (css 에 pre-line)
- 엑셀 행 높이가 구성 줄 수에 따라 커지는 단정이 있다 (지금은 34 고정, quote-xlsx.ts:543)
- 인쇄에서 구성을 접는 설정이 켜져 있으면 접히는 단정이 있다 (I02 의 printComponents)
- 보안: 문서 출력에 원가가 안 실린다 (입력 타입에 원가 자리가 없는 계약 유지)
의존: I02

### I08 견적이 자기 쪽을 안다
상태: 통과
모드: 중량
범위: supabase/migrations/272_crm_quote_source_page.sql (신규), apps/web/prisma/schema.prisma, apps/web/lib/crm/services/quote.ts, apps/web/lib/crm/services/quote-contract.test.ts
감사 기준:
- 마이그레이션이 sourcePageStart·sourcePageEnd·sourceSnapshotId 를 IF NOT EXISTS 로 더하고 칼럼마다 COMMENT 를 다는 단정이 있다
- 스키마·타입·서비스 셋이 같은 칸을 아는 단정이 있다
- 견적을 고쳐 저장해도 쪽 값이 안 지워지는 단정이 있다 (출처는 고친 뒤에도 사실이다)
- 보안: 기존 표에 칼럼만 더한다, RLS 는 이미 켜져 있고 새 정책을 안 만든다, 새 표·새 창구 없음 (S1 확인)
의존: 없음

### I09 건마다 원본 조각을 굳혀 붙인다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/ui/quote-snapshot.ts (신규), apps/web/lib/crm/ui/quote-snapshot.test.ts (신규), apps/web/components/ui/crm/QuoteFromFileModal.tsx, apps/web/package.json
감사 기준:
- 쪽을 모르는 건은 조각을 안 만들고 전체 원본만 붙는 단정이 있다 (틀린 조각이 맞는 것처럼 보이는 것이 제일 나쁘다)
- 설정에서 조각 만들기를 끄면 안 만드는 단정이 있다 (I02 의 snapshot)
- 조각이 첨부 창구와 같은 종류(SUPPLY_QUOTE)로 올라가 대외비 등급을 그대로 받는 단정이 있다
- 조각 만들기가 실패해도 견적 만들기는 안 되돌아가는 단정이 있다
- 보안: 새 업로드 창구를 열지 않는다, 기존 첨부 창구와 등급 규칙을 그대로 쓴다 (S2 확인)
의존: I01, I08

### I10 대조 화면이 그 조각을 먼저 세운다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/ui/quote-original.ts, apps/web/lib/crm/ui/quote-source-surface.test.ts, apps/web/components/ui/crm/QuoteOriginalCompare.tsx, apps/web/components/ui/crm/quote-original-compare.module.css
감사 기준:
- 조각이 있으면 조각을 고르고, 없으면 전체 원본으로 물러서는 단정이 있다
- 전체 원본을 열 때 쪽을 알면 그 쪽부터 여는 단정이 있다 (지금은 늘 1쪽, QuoteOriginalCompare.tsx:251)
- 화면 위에 몇 쪽인지와 건 이름이 뜨는 단정이 있다
- 보안: 서명 주소를 화면 상태나 주소창에 남기지 않는 기존 규칙을 그대로 지킨다
의존: I08, I09

### I11 같은 성격의 자리를 전부 고친다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/ai/prompts/quote-draft.v1.ts, apps/web/lib/crm/ai/schemas/quote-draft.ts, apps/web/lib/crm/domain/quote-cost-intake.ts, apps/web/lib/crm/domain/quote-cost-intake.test.ts
감사 기준:
- 붙여넣기로 만든 견적도 구성을 받는 단정이 있다 (파일만 고치면 같은 화면에서 결과가 갈린다)
- 원가로 보낸 항목도 구성을 함께 나르는 단정이 있다
- 두 경로가 같은 상한을 쓰는 단정이 있다 (I02 한 곳에서 온다)
- 보안: 원가는 문서 출력에 안 실린다는 계약 유지
의존: I03, I05

### I12 구성이 다시 사라지지 않게 잠근다
상태: 대기
모드: 경량
범위: apps/web/lib/crm/services/quote-composition-guard.test.ts (신규), apps/web/lib/policy/quote-import-config-guard.test.ts (신규), apps/web/package.json
감사 기준:
- 골든 원문(광양분소 표 모양)을 읽으면 항목 7건·구성 13줄·금액 없는 행 1건이 나오는 단정이 있다
- 상한 숫자가 설정 fallback 말고 코드에 또 박혀 있으면 실패하는 단정이 있다
- 두 시험 파일이 apps/web/package.json 의 test 한 줄에 등재되고, 등재 뒤 총 시험 수가 실제로 늘어난 것을 확인한다
- 가드를 일부러 깨뜨려 실패를 본 사실을 pass --notes 에 적는다 (S6)
- 보안: 시험이 운영 DB 를 건드리지 않는다 (순수 함수와 문자열 검사만)
의존: I05, I07, I11

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-20) 최초 작성 (ins_0050)
- v0.1.1 (2026-09-20) I02 범위에 설정 카드 배선 3파일 추가 (audit:I02) 읽기 상한은 공급자 정보가 아니라 별도 카드라 묶음·카드 목록·화면을 함께 밟아야 화면에 뜬다
- v0.1.1 (2026-09-20) I02 범위에 설정 카드 배선 3파일 추가, 읽기 상한은 공급자 정보 카드가 아니라 별도 카드라 묶음·카드 목록·화면을 함께 밟아야 화면에 뜬다 (audit:I02)
