# PLAN newAX: 가격 기준을 버전으로 관리하고 할인 겹침과 절사 시점을 정함
플랜 ID: P0157
플랜 버전: v0.1.4
상태: 진행중
지시: iv_0338
목표 버전: v0.11.60
푸시: 모음
작성: 2026-10-23
시작 커밋: 6b0c577b

## 목표
- 새 가격표를 같은 제품의 새 버전으로 올리고 적용일과 품목 가격 변화표가 남는다
- 견적 줄이 어느 가격 기준 버전에서 왔는지 남고, 기준이 바뀐 초안은 보내기 전에 경고한다
- 제품마다 할인 겹침 방식과 「할인 후 합계 절사」를 정하고, 할인 제안값을 한 번에 확정한다

## 범위 밖
- 품목별(줄마다) 절사: 줄 합계와 세금 대조를 깨고, gcube edge 가격표 규칙은 「할인 적용 후 만원 미만 절사」라 할인 후 합계 절사로 충족
- 딜과 미팅 화면 맞추기 (3단계), 견적서 다듬기 (4단계)

## 완료 정의
- pnpm typecheck, pnpm test, pnpm build 통과
- 사용자 노출 문자열은 전부 i18n 키 사용
- 설정값은 env 추가 없이 DB 저장 + UI 관리 (해당 시)
- 실브라우저로 제품 기본 정보, 가져오기 확인 화면, 견적 미리 계산과 보내기 전 점검 확인 (시험 제품으로, 끝나면 휴지통)

## 참조
- newplan/set/REQUIREMENTS.md (REQ-009 010 011 012 023 037)
- 기획 보고 https://claude.ai/artifact/QXRRo98vTspj4GNKmzuauy

## 항목

### I01 가격 기준 버전과 설정 칸 마이그레이션, 1단계 업데이트 내역
상태: 통과
모드: 중량
범위: supabase/migrations/317_crm_pricebook_revision.sql (신규), apps/web/prisma/schema.prisma, apps/web/lib/changelog/entries.ts
감사 기준:
- crm_price_product 에 revision, effectiveFrom, discountStackMode, supplyRoundingUnit, crm_quote 에 supplyRoundingUnit, crm_quote_line 에 priceProductId, priceProductRevision 이 생기고 기존 행은 지금 동작과 같은 기본값 (psql 칼럼 조회)
- 보안: 새 표 없음, 기존 표의 RLS 그대로, 보안 다섯 줄 세기 전부 0
- prisma generate 와 pnpm typecheck 통과
의존: 없음

### I01a 새 칼럼을 견적 복제가 들고 감
상태: 통과
모드: 경량
범위: apps/web/lib/crm/services/quote.ts
감사 기준:
- quote-duplicate.test.ts 의 「모든 칸이 복제에서 셋 중 하나다」 두 건 통과 (I01 뒤 전체 시험에서 깨진 것)
- 보안: 해당 없음, 읽는 칸과 복제 값만
의존: I01

### I01b 인계받은 로그인 가드 시험 갱신과 주석 문체 정리
상태: 통과
모드: 경량
범위: apps/web/lib/auth/admin-audit.test.ts, 「—」 를 「,」 로 바꾼 주석과 시험 문구 15개 파일 (옛 P0155 세션의 미커밋분)
감사 기준:
- admin-audit.test.ts 가 I08 의 throttleLoginAttempt(email) 와 gateLogin 을 봄 (원격 HEAD 는 옛 단정이라 실패 상태)
- 나머지는 대시 문체만, 동작 변경 없음 (diff 확인)
- 보안: 로그인 한도 가드 단정이 살아 있음
의존: 없음

### I02 할인 제안값 한 번에 확정
상태: 통과
모드: 경량
범위: apps/web/app/(crm)/crm/products/[id]/RulesTab.tsx, apps/web/app/(crm)/crm/products/PriceProductListView.tsx, apps/web/lib/terms/pricebook.ts, apps/web/lib/crm/services/pricebook.ts (목록에 미확정 수), apps/web/lib/crm/ui/price-rules-tab.test.ts
감사 기준:
- 할인 탭에 미확정 제안값이 있으면 「제안값 n개 모두 확정」 단추가 보이고 누르면 전부 확정 (실브라우저)
- 제품 목록에 미확정 할인이 있는 제품은 「미확정 n개」 배지 (실브라우저)
- 보안: 해당 없음, 기존 규칙 저장 창구를 그대로 씀
의존: 없음

### I03 변경 이력 「어디서」에 파일 이름 대신 읽을 수 있는 이름
상태: 통과
모드: 경량
범위: apps/web/app/(crm)/crm/products/[id]/HistoryTab.tsx, apps/web/lib/terms/pricebook.ts, apps/web/lib/crm/domain/pricebook/source-label.ts (신규), apps/web/lib/crm/domain/pricebook/source-label.test.ts (신규)
감사 기준:
- 텔레그램 수신 이름(숫자-영숫자.pdf, file_숫자)은 「파일 가져오기」로, 사람이 지은 이름은 그대로 (시험)
- 보안: 해당 없음, 표시만
의존: 없음

### I04 할인 겹침 방식
상태: 통과
모드: 경량
범위: apps/web/lib/crm/domain/pricebook/solution-engine.ts, apps/web/lib/crm/domain/pricebook/solution-engine.test.ts, apps/web/lib/crm/domain/pricebook/types.ts, apps/web/lib/crm/services/pricebook-map.ts, 기본 정보 화면
감사 기준:
- 기관 할인 10% 와 규모 조정 20% 가 겹치면 큰 것 하나 20%, 곱해서 28%, 더해서 30% (시험)
- 기본값은 큰 것 하나라 기존 제품의 계산이 그대로 (gcube edge 예시 시험 그대로 통과)
- 기본 정보에서 고르고 저장하면 미리 계산이 바뀜 (실브라우저)
- 보안: 해당 없음, 기존 제품 저장 창구 그대로
의존: I01

### I05 할인 후 합계 절사
상태: 통과
모드: 중량
범위: apps/web/lib/crm/domain/quote-compose.ts, apps/web/lib/crm/domain/quote-compose.test.ts, apps/web/lib/crm/domain/pricebook/solution-engine.ts, apps/web/lib/crm/services/quote-pricing.ts, 기본 정보 화면, 견적 저장 경로
감사 기준:
- 할인 후 공급가 합계 35,912,345원에 만원 절사면 35,910,000원, 절사 2,345원은 공급가 절사로 잡히고 부가세가 그 뒤에 계산됨 (시험)
- 제품으로 채운 견적을 저장해도 같은 금액 (priceQuote 시험)
- 절사도 할인 승인에 들어감 (1단계 I02 와 같은 길)
- 보안: 할인 승인 판정에 이 절사가 빠지지 않음을 시험으로 확인
의존: I01

### I06 새 가격표를 같은 제품의 새 버전으로
상태: 통과
모드: 경량
범위: apps/web/app/(crm)/crm/products/PricebookImportModal.tsx, apps/web/app/(crm)/crm/products/PriceProductListView.tsx, apps/web/lib/crm/services/pricebook-import.ts, apps/web/app/api/crm/pricebook/import/save/route.ts, apps/web/lib/terms/pricebook.ts
감사 기준:
- 목록에서 가져올 때 「기존 제품의 새 버전으로」를 고르면 그 제품에 저장되고 revision 이 1 오르고 적용일이 남음 (실브라우저)
- 확인 화면에 품목 이전 가격과 새 가격 표 (실브라우저)
- 보안: app/api 창구 ADMIN 게이트 그대로, productId 는 서버가 같은 워크스페이스 제품인지 다시 찾음
의존: I01

### I07 견적 줄에 가격 기준 버전, 바뀐 기준 경고
상태: 통과
모드: 경량
범위: apps/web/lib/crm/domain/pricebook/baseline-check.ts, apps/web/lib/crm/domain/pricebook/baseline-check.test.ts, apps/web/lib/crm/services/quote-pricebook-hooks.ts, 견적 줄 저장 경로
감사 기준:
- 제품으로 채운 견적 줄에 priceProductId 와 revision 이 저장됨 (시험 또는 저장 결과)
- 기준 revision 이 지금과 다르면 보내기 전 점검이 「가격 기준이 바뀌었어요」 경고 (시험)
- 보안: 해당 없음, 읽기와 경고만
의존: I01, I06

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-10-23) 최초 작성 (iv_0338)
- v0.1.1 (2026-10-23) I01 뒤 전체 시험에서 견적 복제 가드 2건 실패, 새 칼럼을 복제가 들고 가게 하는 I01a 삽입 (audit:I01)
- v0.1.3 (2026-10-23) I02 목록 배지에 서비스가 미확정 수를 내야 해서 범위에 pricebook 서비스와 탭 시험 추가 (audit:I02)
- v0.1.2 (2026-10-23) P0155 인계 뒤 미커밋 16개, admin-audit 시험은 HEAD 에서 실패 상태라 I01b 로 커밋 (iv_0365)
- v0.1.4 (2026-10-23) I02 목록 배지에 서비스 미확정 수 필요, 범위 추가 (audit:I02)
