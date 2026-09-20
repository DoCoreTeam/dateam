# PLAN newAX: 견적서는 스냅샷이다 — 할인 없으면 안 적고, 조건은 그날 것으로 굳히고, 원본을 남긴다
플랜 ID: P0037
플랜 버전: v0.2.2
상태: 진행중
지시: ins_0047
목표 버전: v0.10.281
작성: 2026-09-20
시작 커밋: 6ff6989b

## 목표
- 할인을 안 준 견적서에 「할인」이라는 말이 아예 안 나온다 (지금은 「할인 0원」이 찍혀 일부러 안 준 것처럼 읽힌다)
- 설정의 기본 거래 조건을 바꿔도 이미 만든 견적서의 조건이 안 바뀐다, 견적서는 만든 날의 문서다
- 파일로 가져온 견적은 원본 파일이 그 견적에 남아, 제대로 읽혔는지 나중에 대조할 수 있다
- 공급자 정보(상호·대표이사·주소·사업자번호·업태·종목)와 로고도 만든 날 것으로 굳는다 — 회사 정보가 바뀌어도 이미 나간 견적서는 그대로다 (사용자 개입 iv_0088)

## 범위 밖
- 이미 굳은 견적서를 나중 값으로 되살리는 단추 — 굳힌 것을 되돌리는 길을 열면 굳힌 뜻이 없다, 고치려면 새 견적을 만든다
- 엑셀에서 할인 «열» 자체를 빼는 것 — 열 편지를 전부 밀어야 해 수식이 깨진다, 대신 숨긴다
- 부가세 0원 줄 — 면세·영세는 0이 사실이라 적어야 한다

## 완료 정의
- pnpm tsc --noEmit, pnpm test, pnpm build 통과
- 할인 0인 견적서에서 「할인」 글자가 화면·인쇄·엑셀 어디에도 안 나온다
- 설정의 기본 거래 조건을 바꿔도 이미 만든 견적서의 조건 줄이 그대로다
- 설정의 상호·대표이사·로고를 바꿔도 이미 만든 견적서의 공급자 칸과 로고가 그대로다
- 파일로 가져오기로 만든 견적에 원본 파일이 첨부로 붙는다
- 사용자 노출 문자열은 전부 lib/terms 상수 사용
- 설정값은 env 추가 없이 DB 저장 + UI 관리 (해당 시)

## 참조
- LOOP.md 7절 보안 기준
- apps/web/lib/crm/domain/quote-document.ts (문서 SSOT — 화면·인쇄·엑셀 셋이 같은 문서를 본다)
- apps/web/lib/terms/quote.ts (화면 문구 SSOT)

## 항목

### I01 할인이 0이면 견적서가 할인을 말하지 않는다 (화면·인쇄)
상태: 통과
모드: 경량
범위: apps/web/lib/crm/domain/quote-document.ts, apps/web/lib/crm/domain/quote-document.test.ts, apps/web/app/(crm)/crm/quotes/[id]/QuoteSheet.tsx
감사 기준:
- quote-document.ts 에 hasDiscount(doc) 판정 하나를 두고, 할인 0인 문서에 false / 항목 할인율이 있는 문서에 true 를 돌려주는 단정이 quote-document.test.ts 에 있다
- pnpm --filter web exec node --test lib/crm/domain/quote-document.test.ts 통과
- QuoteSheet 가 hasDiscount 가 false 일 때 할인 열(colgroup·thead·각 행 td)과 tfoot 의 할인 줄을 그리지 않고, colSpan 합이 열 수와 맞는다 (tfoot 라벨 colSpan, 묶음 머리 colSpan, 소계 colSpan 전부)
- 보안: 표시 조건만 바꾸고 새 데이터·새 창구·외부 입력이 없다 — 7절 세 질문 전부 아니오
의존: 없음

### I02 같은 규칙을 편집 합계와 엑셀에도
상태: 통과
모드: 경량
범위: apps/web/components/ui/crm/QuoteTotals.tsx, apps/web/lib/crm/services/quote-xlsx.ts, apps/web/lib/crm/services/quote-xlsx.test.ts
감사 기준:
- QuoteTotals 가 discountMinor 가 0이면 할인 줄을 안 그린다
- quote-xlsx 가 할인 0이면 합계에서 할인 행을 빼고, 그때 부가세·계·합계 수식이 가리키는 행 번호가 한 칸씩 당겨진 실제 행을 가리킨다
- quote-xlsx 가 할인 0이면 항목 표의 할인 열을 hidden 으로 둔다 (열 편지를 안 옮기므로 수식은 그대로)
- pnpm --filter web exec node --test lib/crm/services/quote-xlsx.test.ts 통과, 할인 0 문서에서 생성된 시트에 「할인」 라벨 셀이 없다는 단정 포함
- 보안: 표시 조건만 바꾼다 — 7절 세 질문 전부 아니오
의존: I01

### I03 거래 조건 스냅샷 칸을 만들고 이미 있는 견적을 굳힌다
상태: 통과
모드: 중량
범위: supabase/migrations/270_quote_terms_snapshot.sql (신규), prisma/schema.prisma
감사 기준:
- 마이그레이션이 crm_quote 에 terms_snapshot text[] NOT NULL DEFAULT '{}' 을 더한다 (표 신설이 아니라 칼럼 추가라 기존 RLS 가 그대로 적용된다는 사실을 주석에 적는다)
- 같은 판에서 백필: termIds 가 있는 견적은 crm_quote_term.body 를 termIds 순서대로, 비어 있는 견적은 설정의 기본 거래 조건(crm_app_setting, WORKSPACE 가 GLOBAL 을 덮음)을 줄 단위로 넣는다
- 적용 후 psql 로 crm_quote 중 terms_snapshot 이 빈 배열인 건수를 세고, 조건이 실제로 없는 견적만 남는지 확인한 값을 pass --notes 에 적는다
- 보안: RLS 가 꺼진 public 표가 이 판으로 늘지 않는다 (ALTER TABLE 만 하고 CREATE TABLE 이 없음을 diff 로 확인), anon 권한을 새로 주지 않는다
의존: 없음

### I04 만들 때·고칠 때 조건을 굳히고, 읽을 때 굳은 것을 먼저 본다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/services/quote.ts, apps/web/lib/crm/services/quote-document.ts, apps/web/lib/crm/services/quote-terms-snapshot.test.ts (신규)
감사 기준:
- createQuote 가 termIds 로 고른 조건의 «본문»을, 아무것도 안 골랐으면 설정의 기본 거래 조건을 termsSnapshot 에 저장한다
- updateQuote 가 termIds 를 받을 때마다 termsSnapshot 을 다시 굳힌다 (사용자가 고친 것은 반영, 설정이 바뀐 것은 무반영)
- getQuoteDocument 가 termsSnapshot 이 비어 있지 않으면 그것을 쓰고, 비어 있을 때만 예전처럼 살아 있는 조건을 읽는다
- 신규 테스트가 apps/web/package.json 의 test 스크립트에 등재되고, pnpm --filter web exec node --test lib/crm/services/quote-terms-snapshot.test.ts 통과
- 보안: 조건 본문은 이미 그 견적을 볼 수 있는 사람에게 나가던 값이라 노출 범위가 안 넓어진다, 새 창구 없음
의존: I03

### I05 파일로 가져온 견적에 원본 파일을 남긴다
상태: 통과
모드: 경량
범위: apps/web/components/ui/crm/QuoteFromFileModal.tsx, apps/web/lib/terms/quote.ts, apps/web/app/(crm)/crm/quotes/[id]/QuoteDocumentView.tsx, apps/web/app/(crm)/crm/quotes/[id]/quote-document.module.css
감사 기준:
- 원본 남기기가 원가 도착지뿐 아니라 새 견적·붙이기에서도 뜨고, 기본이 켜짐이다
- 견적으로 간 경우 첨부가 그 견적(target=QUOTE, targetId=만들어진 견적 id)에 붙고, 원가로만 간 경우는 지금처럼 딜에 붙는다
- 첨부 창구가 QUOTE 대상을 받는지 실제로 확인하고 못 받으면 딜로 붙이되 사유를 pass --notes 에 적는다
- 견적 상세 화면에 첨부 절이 서서 붙인 원본이 실제로 보인다 (붙기만 하고 볼 자리가 없으면 그 화면엔 기능이 없는 것이다), 인쇄에는 안 나간다
- 문구는 전부 lib/terms/quote.ts 상수, 한자 0건
- 보안: 파일은 기존 첨부 창구(/api/crm/attachments)를 그대로 쓴다 — 새 창구를 안 연다, 등급은 기존 ATTACHMENT_KIND_SENSITIVITY 가 정한다
의존: 없음

### I06 되돌아오지 않게 가드로 잠근다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/domain/quote-discount-visibility.test.ts (신규), apps/web/package.json
감사 기준:
- 가드가 세 표면(QuoteSheet·QuoteTotals·quote-xlsx)에서 할인 표시가 조건 뒤에 있는지 본다 — 이름만 찾지 않고 조건식과 함께 본다
- 가드를 일부러 깨뜨려 (조건을 하나 지우고) 실패하는 것을 확인하고, 그 사실을 pass --notes 에 적는다
- package.json test 스크립트에 등재하고 등재 후 총 테스트 파일 수가 실제로 늘었는지 확인
- 보안: 테스트만 더한다 — 7절 세 질문 전부 아니오
의존: I01, I02

### I07 공급자 정보와 로고를 굳힐 자리를 만들고 이미 있는 견적을 굳힌다
상태: 통과
모드: 중량
범위: supabase/migrations/271_quote_supplier_snapshot.sql (신규), apps/web/prisma/schema.prisma
감사 기준:
- 마이그레이션이 crm_quote 에 supplierSnapshot jsonb NOT NULL DEFAULT '{}' 과 logoAssetHash text 를 더한다
- 로고는 견적 행에 통째로 담지 않는다 — 내용 해시를 키로 하는 crm_quote_asset 표를 만들고 견적은 그 해시를 가리킨다 (실측 로고 97KB, 견적마다 복사하면 견적 천 건에 100MB 가 된다)
- 새 표 crm_quote_asset 은 **같은 판에서** RLS 를 켜고 anon·authenticated 권한을 회수한다 (LOOP.md 7절 S1)
- 같은 판에서 백필: 지금 설정의 공급자 일곱 값과 로고를 모든 기존 견적에 넣는다 (그 견적이 만들어진 날의 값은 남아 있지 않으므로 오늘 값이 최선이고, 그 사실을 주석에 적는다)
- 적용 후 psql 로 supplierSnapshot 이 빈 견적 건수와 crm_quote_asset 행 수를 세어 pass --notes 에 적는다
의존: 없음

### I08 만들 때 공급자와 로고를 굳히고, 읽을 때 굳은 것을 먼저 본다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/services/quote.ts, apps/web/lib/crm/services/quote-document.ts, apps/web/lib/crm/services/quote-asset.ts (신규)
감사 기준:
- createQuote 가 설정의 공급자 일곱 값을 supplierSnapshot 에, 로고를 crm_quote_asset 에 넣고 그 해시를 logoAssetHash 에 저장한다 (같은 로고면 행이 안 늘어난다)
- 복제(다른 안)는 원본의 굳은 값을 그대로 물려받는다 — 같은 견적의 다른 안이 다른 회사 정보를 찍으면 안 된다
- updateQuote 는 공급자·로고를 **다시 굳히지 않는다** — 굳힌 뜻이 「만든 날」이라 고칠 때마다 바뀌면 굳힌 것이 아니다
- getQuoteDocument 가 supplierSnapshot 이 비어 있지 않으면 그것을 쓰고, logoAssetHash 가 있으면 그 자산을 읽는다, 둘 다 비었을 때만 예전처럼 설정을 읽는다
- 보안: 자산은 이미 그 견적을 볼 수 있는 사람에게 인쇄되어 나가던 이미지다, 새 창구를 안 연다
의존: I07

### I09 세 가지가 다 굳는지 가드로 잠근다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/services/quote-terms-snapshot.test.ts, apps/web/package.json
감사 기준:
- 가드가 조건·공급자·로고 셋 모두에 대해 「만들 때 굳힌다」와 「읽을 때 굳은 것이 먼저다」를 본다
- 가드를 일부러 깨뜨려 실패를 확인하고 그 사실을 pass --notes 에 적는다 (주석 처리해도 통과하지 않는지까지 본다)
- 보안: 테스트만 더한다 — 7절 세 질문 전부 아니오
의존: I08

### I10 종합 감사에서 드러난 가드 두 건을 맞춘다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/db/workspace-guard.ts, apps/web/lib/ui/quote-layout.test.ts
감사 기준:
- CrmQuoteAsset 이 워크스페이스 분류 넷 중 하나에 들어가고 왜 그 분류인지가 주석에 있다 (workspaceId 칼럼이 없는 모델이 direct 로 남으면 런타임에 Prisma 가 던진다)
- quote-layout 가드가 원본 남기기의 새 규칙(기본 켜짐, 도착지를 안 가림, 견적이 있으면 그 견적에 붙음)을 본다
- pnpm test 전체 실패 0건
- 보안: 분류를 정하는 일이라 새 데이터·새 창구·외부 입력이 없다 — 7절 세 질문 전부 아니오
의존: 없음

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-20) 최초 작성 (ins_0047)
- v0.2.0 (2026-09-20) 견적서 스냅샷을 거래 조건만이 아니라 공급자 정보와 로고까지 넓힘, 회사 정보가 바뀌어도 이미 나간 견적서는 그대로여야 한다는 사용자 지시, I07 칸과 백필·I08 굳히기와 읽기·I09 가드 추가 (iv_0088)
- v0.2.1 (2026-09-20) I05 범위에 견적 상세 화면과 인쇄 규칙 추가, 첨부 창구는 QUOTE 를 받는데 견적 상세에 첨부 절이 없어 붙여도 볼 자리가 없었다 (audit:I05)
- v0.2.2 (2026-09-20) 종합 감사에서 가드 2건 어긋남 발견, 보완 항목 I10 추가 (audit:final)
