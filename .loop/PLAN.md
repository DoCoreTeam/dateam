# PLAN newAX: 견적 품목이 대수와 기간 두 축으로 선다
플랜 ID: P0117
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0203
목표 버전: v0.10.953
작성: 2026-10-06
시작 커밋: fbd114d5

## 목표
- 견적 품목 한 줄이 「17대 × 2개월」처럼 대수와 기간 두 축을 함께 들고 그 둘을 곱한 금액을 낸다
- 손으로도 적을 수 있고 파일에서 읽어 올 때도 자동으로 채워진다
- 기간을 시간으로 환산해 시간당·월·기간 총액 축에 그대로 쓴다
- 실측 사고 복구: 견적 DA-2026-1006-03 이 원본 34,980,000원 대신 17,503,200원으로 저장된 일이 구조적으로 못 일어나게 한다

## 범위 밖
- 기존 164줄 백필 — 단위가 「개월」인 9줄과 「Hours」인 3줄은 한 축으로 맞는 줄이라 금액을 안 건드린다
- 「한 대당 시간당 금액」 축 신설 — 17대 묶음 시간당과 17배 차이라 둘을 나란히 두면 고르는 사람이 헷갈린다. 축 이름에 기준 대수를 적는 것으로 대신한다
- 기간 단위에 「주」 추가 — 월 환산이 안 떨어져 「약」이 늘 붙는다. 개월·일·시간·년 넷으로 지금 데이터를 전부 덮는다
- 견적서 품목 표에 열 추가 — 이미 나간 견적서 전부의 폭이 바뀐다. 수량 칸 안에서 두 줄로 적는다

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 기간 칸이 빈 기존 품목 164줄의 금액이 한 줄도 안 바뀐다 (저장소 실측으로 확인)
- 편집 모달에서 수량 17 대 + 기간 2 개월을 적으면 줄 합계가 31,824,000원이 되고 견적서·엑셀이 같은 산식을 적는다
- 파일에서 읽을 때 수량 칸의 숫자를 기간으로 적지 않고, 단위를 못 읽으면 종류 기본값으로 덮어쓰지 않는다
- 사용자 노출 문자열은 전부 lib/terms 상수 사용
- 설정값은 env 추가 없이 DB 저장 + UI 관리 (해당 없음 — 새 설정값 없음)

## 참조
- LOOP.md 7절 보안 기준, 9절 U-N 화면 문구 / F-N 기능 완결성
- lib/terms/quote.ts, lib/terms/cost.ts (말의 SSOT — 화면에 한글 문자열 직접 금지)
- lib/crm/domain/quote-math.ts (금액 계산 SSOT), quote-rate.ts (환산 SSOT), quote-rate-text.ts (글 짓는 곳 SSOT)
- supabase/migrations/303_crm_quote_rate_display.sql (칼럼 추가 마이그 양식과 보안 주석 양식)

## 항목

### I01 저장 자리를 만든다 — 품목과 원가에 기간 두 칸
상태: 통과
모드: 중량
범위: supabase/migrations/305_crm_quote_line_duration.sql (신규), apps/web/prisma/schema.prisma
감사 기준:
- 보안: 새 표가 아니라 있는 표(crm_quote_line·crm_deal_cost) 둘에 칼럼이다. 두 표의 RLS 가 이미 켜져 있고 정책이 서 있음을 psql 로 확인해 PLAN 에 적는다. CREATE TABLE AS 사본을 만들지 않으므로 잠금이 떨어질 자리가 없다
- 보안: 새 칼럼에 비밀값 없음(수와 단위 문자열). anon 권한·정책을 건드리지 않음을 마이그 본문으로 확인
- psql 로 마이그 적용 후 `\d crm_quote_line` 에 durationValue·durationUnit 이 보이고 CHECK 셋(값>0, 단위 네 가지, 둘은 한 벌)이 걸려 있다
- 적용 후 crm_quote_line 164줄의 durationValue 가 전부 NULL 이다 (기존 행 안 건드림)
- pnpm tsc --noEmit 통과 (schema.prisma 생성 타입이 새 칸을 안다)
의존: 없음

### I02 셈에 기간 축을 더한다 — computeLine
상태: 대기
모드: 경량
범위: apps/web/lib/crm/domain/quote-math.ts, apps/web/lib/crm/domain/quote-math.test.ts
감사 기준:
- 기간이 없으면 배수가 1 이다: 기존 단정이 한 개도 안 깨지고 pnpm test 의 quote-math 가 통과한다
- 936,000 × 수량 17 × 기간 2 = 31,824,000 이 나오는 단정이 있다
- 할인이 기간 곱 **뒤**에 걸린다 (수량과 같은 자리) — 기간 2, 기본 할인 10% 일 때 결과가 (단가×수량×2)×0.9 임을 단정으로 확인
- 기간 값이 0·음수·NaN 이면 1 로 본다 (금액이 0 이 되거나 음수가 되지 않는다)
의존: I01

### I03 기간을 시간으로 환산한다
상태: 대기
모드: 경량
범위: apps/web/lib/crm/domain/quote-rate.ts, apps/web/lib/crm/domain/quote-rate.test.ts, apps/web/lib/terms/quote.ts
감사 기준:
- 2개월 × 730 = 1,460h, 30일 × 24 = 720h, 1년 = 12 × 730h, 48시간 = 48h 가 나오는 단정 넷
- 총 시간은 **달력 시간**이다 — 수량 17 을 곱하지 않는다는 단정 (17대 2개월이 24,820h 가 아니라 1,460h)
- 기간 단위 네 가지 라벨이 lib/terms 에 있고 코드가 한글 문자열을 직접 안 쓴다
- pnpm test 의 quote-rate 통과
의존: I02

### I04 문서가 기간 축을 첫 근거로 본다
상태: 대기
모드: 경량
범위: apps/web/lib/crm/domain/quote-document.ts, apps/web/lib/crm/domain/quote-rate-text.ts, apps/web/lib/crm/domain/quote-rate-text.test.ts
감사 기준:
- 총 시간의 근거 순서가 기간 칸 → 날짜 → 수량 단위다. 셋 다 있을 때 기간 칸이 이긴다는 단정
- 기간 칸만 있고 날짜가 없는 줄에서 시간당·월 금액 축이 선다는 단정 (날짜 0줄 실측이 이 자리에서 막혔었다)
- 시간당 축 글에 기준 대수가 함께 적힌다 — 수량이 2 이상이면 「17대 기준」이 붙고 1 이면 안 붙는다는 단정 둘
- pnpm test 의 quote-rate-text·quote-document 통과
의존: I03

### I05 서버가 기간 두 칸을 받고 저장하고 돌려준다
상태: 대기
모드: 중량
범위: apps/web/lib/crm/services/quote.ts, apps/web/lib/crm/services/quote-contract.test.ts
감사 기준:
- 보안: LINE_KEYS 화이트리스트에 durationValue·durationUnit 을 더한다. 모르는 이름은 여전히 거절된다는 기존 단정이 안 깨진다
- 보안: durationUnit 이 네 가지 밖의 값이면 서버가 거절한다 (DB CHECK 에 닿기 전에 사람이 읽을 메시지로)
- QuoteLineRow·LINE_SELECT·normalizeLine 세 자리에 새 칸이 다 있다 — 값이 가는지를 보는 단정 (선언만 하고 안 넘기는 판을 잡는다)
- 저장 → 조회 왕복으로 durationValue 2, durationUnit MONTH 가 그대로 돌아온다
의존: I02

### I06 편집 모달에서 기간을 적는다
상태: 대기
모드: 경량
범위: apps/web/components/ui/crm/QuoteLineDurationFields.tsx (신규), apps/web/components/ui/crm/QuoteEditorModal.tsx, apps/web/components/ui/crm/quote-draft-shape.ts, apps/web/components/ui/crm/quote-panel.module.css
감사 기준:
- 기간 칸 둘이 **종류를 안 가리고 늘 선다** — sellsByTime 으로 가리지 않는다는 단정 (날짜 칸은 가려서 164줄 중 0줄이 썼다)
- 수량 17 · 단위 대 · 기간 2 · 개월 · 단가 936,000 을 적으면 줄 밑 산식이 「936,000원 × 17대 × 2개월 = 31,824,000원」을 적는다
- 화면 문구는 전부 lib/terms 상수에서 온다 (한글 문자열 직접 금지 가드 통과)
- toLinePayload 가 durationValue·durationUnit 을 싣는다 — 값이 가는지를 보는 단정
의존: I05

### I07 좁은 폭에서 칸 둘이 늘어도 안 접힌다
상태: 대기
모드: 경량
범위: apps/web/lib/ui/quote-layout.test.ts, apps/web/components/ui/crm/quote-panel.module.css
감사 기준:
- 1,280 과 390 두 폭에서 품목명 칸이 석 줄이 되지 않고 가로 넘침이 0 이다 (넘침 0 만 보지 않고 칸 폭·줄 수를 함께 잰다)
- 수량·단위·기간·기간단위 넷이 한 묶음으로 함께 접힌다 (기간만 떨어져 나가지 않는다)
- pnpm test 의 quote-layout 통과
의존: I06

### I08 견적서와 엑셀이 두 축을 같은 말로 적는다
상태: 대기
모드: 경량
범위: apps/web/components/ui/crm/QuoteSheet.tsx, apps/web/lib/crm/services/quote-xlsx.ts, apps/web/lib/crm/services/quote-xlsx.test.ts, apps/web/lib/terms/quote.ts
감사 기준:
- 견적서 수량 칸이 「17 대」와 「× 2개월」 두 줄로 서고 **열은 안 늘어난다** (열 수가 전과 같다는 단정)
- 엑셀과 화면이 같은 글을 적는다 — 둘 다 quote-rate-text 를 지난다는 단정 (각자 지으면 서서히 갈린다)
- 기간이 없는 줄은 전과 똑같이 그려진다 (기존 스냅샷 단정 안 깨짐)
- pnpm test 의 quote-xlsx 통과
의존: I04, I06

### I09 파일에서 기간을 읽는다 — 스키마와 지시
상태: 대기
모드: 경량
범위: apps/web/lib/crm/ai/schemas/quote-from-doc.ts, apps/web/lib/crm/ai/schemas/quote-from-doc.test.ts, apps/web/lib/crm/ai/prompts/quote-from-doc.v1.ts, apps/web/lib/crm/ai/prompts/quote-from-doc-prompt.test.ts
감사 기준:
- 줄과 건 둘 다에 durationValue·durationUnit 이 있고, 못 읽으면 null 이다 (0 이나 1 로 눕히지 않는다)
- 지시에 넷이 들어 있다: 수량 칸 숫자를 기간으로 적지 마라 · 표 밖 「약정 기간」·「계약기간」·「이용기간」은 그 건의 기간이다 · 표 아래 합계행을 항목이나 구성 줄로 만들지 마라 · 단위를 못 읽었으면 null
- 이번 원본과 같은 모양의 응답(수량 17, 단위 대, 기간 2 개월)이 스키마를 통과한다는 단정
- pnpm test 의 quote-from-doc 통과
의존: I02

### I10 읽은 값이 폼에 그대로 닿는다 — 단위 폴백을 끊는다
상태: 대기
모드: 경량
범위: apps/web/components/ui/crm/quote-review.tsx, apps/web/components/ui/crm/QuoteFillPanel.tsx, apps/web/lib/crm/ui/quote-source-surface.test.ts
감사 기준:
- 단위를 못 읽으면 빈칸이다 — 종류 기본값(LINE_KIND_UNIT)으로 덮어쓰는 코드가 두 파일 모두에서 사라졌다는 단정 (이번 사고의 직접 원인)
- 건 수준 기간은 줄에 기간이 없을 때만 **제안**으로 뜨고 자동 적용되지 않는다
- 읽은 기간이 폼의 기간 칸에 닿는다 — 값이 가는지를 보는 단정
- pnpm test 의 quote-source-surface 통과
의존: I09, I06

### I11 대조가 기간을 포함해 센다
상태: 대기
모드: 경량
범위: apps/web/lib/crm/domain/quote-reconcile.ts, apps/web/lib/crm/domain/quote-reconcile.test.ts
감사 기준:
- 줄 대조가 기간을 곱한 금액으로 선다 — 17 × 936,000 × 2 와 문서 금액 31,800,000 의 차이가 24,000 으로 나온다는 단정
- 기간을 못 읽어 금액이 모자란 줄에 전용 사유가 붙는다 (그냥 「금액 안 맞음」이 아니라 무엇이 빠졌는지 말한다)
- 기간이 없는 기존 줄의 대조 결과가 전과 같다 (기존 단정 안 깨짐)
의존: I02, I09

### I12 원가에도 같은 두 축이 선다
상태: 대기
모드: 경량
범위: apps/web/lib/crm/services/cost.ts, apps/web/lib/crm/domain/cost-to-quote.ts, apps/web/lib/crm/domain/cost-to-quote.test.ts, apps/web/components/ui/crm/CostToQuoteModal.tsx
감사 기준:
- 원가 줄이 durationValue·durationUnit 을 저장하고 돌려준다 (칸 이름이 견적 줄과 같다)
- 원가를 견적으로 옮길 때 기간 두 칸이 따라간다 — 값이 가는지를 보는 단정
- 17대 2개월 매출에 2개월 원가가 붙어 마진율이 한 달치로 거짓이 되지 않는다는 단정
의존: I05

### I13 베끼는 길이 새 칸을 떨어뜨리지 않는다
상태: 대기
모드: 경량
범위: apps/web/lib/crm/services/quote.ts, apps/web/lib/crm/services/quote-duplicate.test.ts
감사 기준:
- 복제·개정이 durationValue·durationUnit 을 들고 간다 — 값이 가는지를 보는 단정
- 가드가 **사람이 적은 목록이 아니라 스키마를 세어** 확인한다. schema.prisma 의 CrmQuoteLine 칸 목록에서 일부러 안 들고 가는 것을 뺀 나머지가 전부 복제 본문에 있는지 본다
- 그 가드를 일부러 깨뜨려(한 칸을 빼고) 실패하는 것을 확인하고 근거를 pass 노트에 적는다
의존: I05

### I14 딜의 기간이 기본값으로 들어온다
상태: 대기
모드: 경량
범위: apps/web/components/ui/crm/quote-draft-shape.ts, apps/web/components/ui/crm/QuotePanel.tsx, apps/web/lib/crm/domain/quote-rate.test.ts
감사 기준:
- 딜에 시작일·종료일이 있으면 새 품목의 기간 칸이 그 길이로 채워진다 (딱 떨어지면 개월, 안 떨어지면 일)
- 딜에 기간이 없으면 빈칸이다 (1 로 눕히지 않는다)
- 사람이 고친 기간은 딜 기간으로 다시 덮이지 않는다
의존: I06

### I15 기간이 수량 칸에 있는 옛 줄을 화면이 말한다
상태: 대기
모드: 경량
범위: apps/web/components/ui/crm/QuoteEditorModal.tsx, apps/web/lib/crm/domain/quote-rate.ts, apps/web/lib/terms/quote.ts, apps/web/lib/ui/quote-layout.test.ts
감사 기준:
- 단위가 기간을 가리키는 말(개월·Hours 따위)인데 기간 칸이 비면 그 줄 옆에 안내가 선다
- 안내는 **못 하는 것만** 말한다 — 금액은 맞으므로 「틀렸다」고 하지 않고 「기간이 수량 칸에 있습니다」라고 적는다
- 안내 문구가 lib/terms 에서 온다
- 금액을 바꾸지 않는다 (옛 9줄과 3줄의 합계 불변)
의존: I06

### I16 대조 결과를 원장에 남긴다
상태: 대기
모드: 중량
범위: supabase/migrations/306_quote_import_check_log.sql (신규), apps/web/prisma/schema.prisma, apps/web/lib/crm/services/quote.ts
감사 기준:
- 보안: 새 표다. 같은 마이그레이션에서 RLS 를 켜고 정책을 세운다. TO public 을 쓰지 않고 authenticated 와 실제 조건을 쓴다. CREATE TABLE AS 를 안 쓴다
- 보안: 적용 후 rls-baseline 가드가 통과하고, 그 표가 anon 으로 읽기·쓰기 안 되는 것을 실제로 확인한다
- 파일로 만든 견적을 저장하면 읽은 줄 수·대조 통과 줄 수·합계 차액이 한 행으로 남는다
- 「손 안 대고 맞은 건 수 ÷ 읽은 건 수」를 한 질의로 셀 수 있다
의존: I11

### I17 업데이트 내역에 적는다
상태: 대기
모드: 경량
범위: apps/web/lib/changelog/entries.ts
감사 기준:
- 이번 버전 블록이 맨 위에 서고 사용자 말로 적혀 있다 (개발 지시나 구현 보고가 화면에 안 남는다)
- pnpm test 의 version-rule 통과
의존: I08, I10

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-10-06) 최초 작성 (ins_0203)
