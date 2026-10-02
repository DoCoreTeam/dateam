# PLAN newAX: 공급사 외화 견적이 통화를 지닌 채 원가에 앉고 견적으로 돌아간다
플랜 ID: P0102
플랜 버전: v0.1.6
상태: 진행중
지시: ins_0173
목표 버전: v0.10.835
작성: 2026-10-02
시작 커밋: 4ed6aa7c

## 목표
- 공급사에서 받은 외화 견적서 한 장이 통화와 수량과 단가를 그대로 지닌 채 딜 원가에 앉는다
- 원가 합계와 마진이 통화를 세어 사실을 말한다 (실측 딜에서 마진율 94.6% 가 27.3% 로 내려간다)
- 견적서를 만들 때 「딜 원가에서 가져오기」 단추 하나로 그 항목이 견적 줄이 되고, 달러로 낼지 원화로 낼지를 그 자리에서 고른다
- 환율이 묵지 않는다 (지금 2026-09-14 고시에서 멈춰 있고 갱신 크론이 없다)

## 범위 밖
- 딜 금액(매출)의 다통화 지원, 이번에는 원가만 통화를 가진다
- 이미 잘못 들어간 원가 행의 일괄 보정, 실측 1건이고 화면에 삭제 단추가 있어 사람이 지운다 (사용자 확인 2026-10-02)
- 견적서 PDF 양식, quote-document.ts 가 이미 외화 견적에 원화 환산을 찍고 있어 건드릴 것이 없다

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 공급사 USD 견적서를 원가로 보내면 항목이 USD 로 저장되고 그날 환율이 함께 박힌다
- 원가 패널이 항목 통화로 금액을 적고 그 아래 원화 환산과 고시일을 밝힌다
- 1280 폭과 390 폭에서 원가 줄이 가로로 터지지 않는다
- 「딜 원가에서 가져오기」로 고른 원가가 수량과 단가를 지닌 견적 줄이 된다
- 환율을 못 받은 항목은 0 으로 눕지 않고 합계에서 빠진 사실과 사유를 화면이 말한다
- 사용자 노출 문자열은 lib/terms 를 지난다

## 참조
- 기획 보고 https://claude.ai/code/artifact/f2f42957-d2fc-44dc-9f7a-b5a4ca635434
- 환율 SSOT apps/web/lib/crm/services/fx.ts, 통화 환산 SSOT apps/web/lib/crm/domain/currency.ts
- 견적 줄 모델 apps/web/prisma/schema.prisma CrmQuoteLine, 원가 모델 CrmDealCost
- LOOP.md 7절 보안 기준, 9절 U-N 화면 문구와 F-N 기능 완결성

## 항목

### I01 원가 표가 통화와 수량과 단가를 담는다
상태: 통과
모드: 경량
범위: supabase/migrations/302_crm_deal_cost_currency_and_line.sql (신규), apps/web/prisma/schema.prisma
감사 기준:
- 보안: 새 표가 아니라 기존 crm_deal_cost 에 칸만 더하므로 새 RLS 정책이 필요 없다, 229 가 켜 둔 ENABLE ROW LEVEL SECURITY 와 REVOKE 가 그대로인지 확인하고 pnpm test 의 rls-baseline 이 초록인 것으로 본다
- 마이그레이션 적용 후 crm_deal_cost 에 "fxRate" "fxDate" "fxSource" quantity unit "unitPriceMinor" kind remark 열이 있다, 통화는 229 가 이미 만들어 둔 currency 칸을 쓰고 새로 만들지 않는다, 규격도 새 칸을 만들지 않고 descriptionMd 첫 줄 약속(lib/crm/domain/quote-spec.ts 의 joinSpec·splitSpec)을 그대로 쓴다
- 기존 행은 변하지 않는다, 적용 전후 count(*) 와 sum("amountMinor") 가 같다
- prisma schema 가 같은 칸을 들고 pnpm tsc --noEmit 통과
의존: 없음

### I02 읽은 것을 그대로 싣는다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/domain/currency.ts, apps/web/lib/crm/domain/quote-cost-intake.ts, apps/web/lib/crm/domain/quote-cost-intake.test.ts, apps/web/lib/crm/services/cost.ts, apps/web/components/ui/crm/QuoteFromFileModal.tsx
감사 기준:
- 보안: 밖에서 온 통화 코드를 그대로 저장하지 않는다, ISO 세 글자 대문자만 받고 아니면 VALIDATION_FAILED, 단위 시험으로 확인한다
- toCostPayloads 가 currency quantity unit unitPriceMinor kind remark descriptionMd 를 싣는다, 단위 시험이 USD 줄에서 그 일곱 칸을 단정하고 규격이 descriptionMd 첫 줄에 서는 것도 단정한다
- insertCost 가 통화가 KRW 가 아닐 때 latestFxRate 로 환율을 박는다, 환율을 못 받으면 fxRate 를 null 로 두고 0 이나 1 로 눕히지 않는다
- pnpm test quote-cost-intake 통과
의존: I01

### I03 합계가 통화를 센다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/domain/cost.ts, apps/web/lib/crm/domain/cost.test.ts, apps/web/lib/crm/services/cost.ts
감사 기준:
- 보안: 해당 없음, 저장도 창구도 외부 입력도 늘지 않는다 (순수 계산 함수와 그 호출부만 바뀐다)
- computeCostTotals 가 통화가 섞인 묶음에서 rollupToBase 를 지나 딜 통화로 모은다, 단위 시험이 USD 1080.00 과 KRW 100000 섞인 묶음의 합계를 단정한다
- 환율이 없는 줄은 합계에 0 으로 들어가지 않고 skipped 로 돌아온다, 단위 시험이 skipped 건수를 단정한다
- pnpm test cost 통과
의존: I02

### I04 원가 화면이 통화와 환산을 말한다
상태: 통과
모드: 경량
범위: apps/web/components/ui/crm/CostPanel.tsx, apps/web/components/ui/crm/cost-panel.module.css, apps/web/lib/terms/cost.ts, apps/web/lib/crm/domain/currency.ts, apps/web/app/(crm)/crm/deals/DealCloseModal.tsx, apps/web/app/(crm)/crm/deals/DealFormModal.tsx, apps/web/app/(crm)/crm/deals/amount.ts, apps/web/app/(crm)/crm/deals/amount.test.ts, apps/web/lib/ui/picker-standard.test.ts
감사 기준:
- 보안: 해당 없음, 읽기 화면이고 원가 권한 게이트(cost.view)는 기존 창구가 그대로 본다
- 항목 금액이 그 항목의 통화로 그려진다, USD 항목이 $1,080.00 으로 보인다
- 환산액과 고시일이 금액 아래 한 줄로 붙는다, 환율이 없으면 환산액 자리에 사유가 뜬다
- 근거 줄이 두 줄에서 접힌다, cost-panel.module.css 에 .basis 의 white-space nowrap 이 없다
- 원가 직접 입력 모달에 통화 칸이 있다
- 실브라우저 1280 폭과 390 폭에서 원가 줄의 가로 넘침이 0 이다 (scrollWidth 와 clientWidth 비교)
- 화면 문구는 lib/terms/cost.ts 를 지난다, pnpm test glossary 와 product-copy 통과
의존: I03

### I05 견적서가 딜 원가를 가져온다
상태: 대기
모드: 경량
범위: apps/web/lib/crm/domain/cost-to-quote.ts (신규), apps/web/lib/crm/domain/cost-to-quote.test.ts (신규), apps/web/components/ui/crm/CostToQuoteModal.tsx (신규), apps/web/components/ui/crm/QuotePanel.tsx, apps/web/package.json
감사 기준:
- 보안: 원가는 cost.view 가 있어야 읽는다, 단추를 감추는 것으로 대신하지 않고 GET /api/crm/deals/:id/costs 가 그대로 403 을 내는 것을 확인한다
- cost-to-quote 가 원가 행을 견적 줄로 옮긴다, 단위 시험이 quantity unit unitPriceMinor kind 가 그대로 가는 것과 통화가 다를 때 환산되는 것을 단정한다
- 마진 기본값이 원가 그대로가 아니다, 단위 시험이 기본 모드에서 단가가 원가보다 큰 것을 단정한다
- 통화 고르기가 창에 있고 원화를 고르면 환산 환율과 고시일이 견적 초안에 실린다
- 새 시험 파일이 apps/web/package.json 의 test 스크립트에 등재되고 등재 후 총 시험 수가 늘어난다
- 실브라우저에서 딜 상세의 견적 패널에 「딜 원가에서 가져오기」가 서고 눌러서 견적 줄이 들어가는 것까지 확인한다
의존: I04

### I06 환율이 묵지 않는다
상태: 대기
모드: 중량
범위: apps/web/app/api/cron/fx-sync/route.ts (신규), apps/web/vercel.json, apps/web/lib/policy/api-auth-surface.test.ts
감사 기준:
- 보안: 새 창구다, isMachineCall 을 지나고 machineAuthUnconfigured 면 503 을 낸다, 인증 없이 부르면 401 인 것을 확인한다
- 보안: 서비스롤로 쓰는 자리이므로 import 'server-only' 와 기계 인증이 둘 다 있는지 확인한다
- api-auth-surface 가 새 경로를 알고 통과한다
- vercel.json crons 에 fx-sync 가 하루 한 번 들어간다
- 창구를 직접 호출해 fx_rates_multi 의 최신 rate_date 가 오늘 또는 직전 영업일로 올라온다
의존: 없음

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-10-02) 최초 작성 (ins_0173)
- v0.1.1 (2026-10-02) I01 감사 기준이 실제 칼럼 규약과 달랐다, crm_deal_cost 는 따옴표 캐멀케이스를 쓰고 통화 칸(currency)은 229 가 이미 만들어 두었다, source_currency 를 새로 만들면 통화가 두 칸이 된다 (audit:I01)
- v0.1.2 (2026-10-02) spec 칸을 안 만든다, 규격은 crm_quote_line 에도 칸이 없고 descriptionMd 첫 줄 약속(quote-spec.ts)이 SSOT 다, 원가에만 칸을 만들면 규격이 두 자리에 살고 견적 줄로 옮길 때 어느 쪽을 믿을지 모른다 (audit:I01)
- v0.1.2 (2026-10-02) spec 칸을 안 만든다, 규격은 crm_quote_line 에도 칸이 없고 descriptionMd 첫 줄 약속(quote-spec.ts)이 SSOT 다 (audit:I01)
- v0.1.3 (2026-10-02) I02 범위에 domain/currency.ts 를 넣는다, 통화 코드가 ISO 세 글자인지 묻는 자리는 환산 SSOT 옆이 제자리다, 받은 견적서 길에만 두면 직접 입력 길이 같은 검사를 안 지난다 (audit:I02)
- v0.1.3 (2026-10-02) I02 범위에 domain/currency.ts 추가, 통화 코드 ISO 검사를 환산 SSOT 옆에 둔다 (audit:I02)
- v0.1.4 (2026-10-02) I04 범위에 통화 고르기 목록 SSOT 를 넣는다, ['KRW','USD','JPY','EUR'] 가 딜 성사 모달과 딜 폼 모달에 이미 두 벌 있어 원가 모달이 세 벌째가 된다, 목록을 domain/currency.ts 로 올리고 있던 두 벌도 그것을 쓰게 한다 (audit:I04)
- v0.1.4 (2026-10-02) I04 범위에 통화 목록 SSOT(domain/currency.ts)와 이미 같은 배열을 든 딜 모달 둘을 넣는다 (audit:I04)
- v0.1.5 (2026-10-02) I04 범위에 금액 표시 SSOT(deals/amount.ts)를 넣는다, maximumFractionDigits 만 줘서 USD 108000 센트가 「$1,080」으로, 108050 이 「$1,080.5」로 떴다, 돈을 그렇게 적는 곳은 없고 quote-xlsx 는 이미 #,##0.00 을 쓴다, 최소 자리수를 통화 자리수로 박아 화면과 엑셀이 같은 말을 하게 한다 (audit:I04)
- v0.1.5 (2026-10-02) I04 범위에 금액 표시 SSOT(deals/amount.ts) 추가, USD 센트가 $1,080.5 로 뜨던 것을 두 자리로 박는다 (audit:I04)
- v0.1.6 (2026-10-02) I04 범위에 picker-standard.test.ts 를 넣는다, 통화 칸이 드롭다운이라 「사유 없는 드롭다운」 수가 109 에서 110 으로 늘어 가드가 막았다, 통화는 그 가드 머리말이 적은 「고정 목록」의 예라 WHY_SELECT 에 사유를 적고 같은 배열을 쓰던 딜 모달 둘도 함께 적어 기준값을 107 로 내린다 (audit:I04)
- v0.1.6 (2026-10-02) I04 범위에 picker-standard.test.ts 추가, 통화 드롭다운 사유 등재와 기준값 107 로 하향 (audit:I04)
