# PLAN newAX: 직인을 설정에서 올리고 견적서에 찍는다
플랜 ID: P0042
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0055
목표 버전: v0.10.326
작성: 2026-09-21
시작 커밋: dabf4338

## 목표
- 설정 「견적」 탭에서 로고처럼 **직인 그림 파일을 올릴 수 있다**
- 올린 회사의 견적서에는 상호 옆에 직인이 찍히고, 안 올렸으면 「(직인생략)」 문구가 그 자리에 선다
- 화면·인쇄·PDF·엑셀 넷이 같은 답을 낸다

## 범위 밖
- 직인 위치·크기를 사용자가 고르는 기능 (상호 옆 한 자리로 고정)
- 전자서명·타임스탬프 같은 법적 날인 (그림 한 장일 뿐이다)
- 로고 쪽 동작 변경

## 완료 정의
- pnpm lint, pnpm test 통과 (타입은 tsc --noEmit)
- `lib/crm/wired.test.ts` 의 「공급자 설정 키가 정의와 읽는 쪽에서 같다」 초록
- 사용자 노출 문자열은 전부 `lib/terms` 상수
- 설정값은 env 추가 없이 DB 저장 + UI 관리
- 실브라우저에서 직인 올리기 → 견적서에 찍힘 → 지우기 → 「(직인생략)」 복귀를 눈으로 확인

## 참조
- `supabase/migrations/271_quote_supplier_snapshot.sql` — 로고를 굳히는 방식(같은 벽을 쓴다)
- `apps/web/lib/crm/services/quote-asset.ts` — 내용 해시로 그림을 한 번만 담는 규칙
- LOOP.md 7절 S1(새 칼럼·RLS) · S4(밖에서 온 그림)

## 항목

### I01 설정에 직인 항목을 연다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/services/setting.ts
감사 기준:
- `node --test --experimental-strip-types lib/crm/wired.test.ts` 통과 (지금은 `quote.supplier.seal` 로 실패한다)
- `GET /api/crm/settings` 응답에 `quote.supplier.seal` 이 `kind: "image"`, `group: "quote"` 로 들어 있다
- 보안 S4: 새 값은 밖에서 온 그림이다 — `assertImage` 가 `def.kind === 'image'` 로 이미 걸리는지 저장 경로에서 확인하고, SVG 를 넣어 거절되는 것을 본다
의존: 없음

### I02 직인도 만든 날 그대로 굳힌다
상태: 대기
모드: 중량
범위: supabase/migrations/274_quote_seal_asset.sql (신규), apps/web/prisma/schema.prisma, apps/web/lib/crm/services/quote.ts
감사 기준:
- 마이그레이션 적용 후 `\d crm_quote` 에 `sealAssetHash` 가 있다
- 보안 S1: 칼럼 추가라 기존 RLS 가 그대로 적용됨을 확인하고, `crm_quote_asset` 은 271 이 이미 RLS 를 켜고 anon·authenticated 권한을 회수했음을 재확인한다 (새 표 없음)
- 견적을 새로 만들면 그때의 직인 해시가 `sealAssetHash` 에 박힌다 (설정을 바꿔도 그 견적은 안 바뀐다)
- 기존 견적은 `sealAssetHash` 가 null 이라 「(직인생략)」이다 — 백필하지 않는다(그날 직인이 없었다)
의존: I01

### I03 문서가 직인을 읽는다
상태: 대기
모드: 경량
범위: apps/web/lib/crm/services/setting.ts, apps/web/lib/crm/services/quote-document.ts, apps/web/lib/crm/domain/quote-document.ts
감사 기준:
- `readQuoteImages` 가 `{ logo, seal }` 을 준다
- `QuoteDocument.images` 에 `seal` 이 있고, 굳은 해시가 있으면 설정 대신 그 그림을 읽는다
- `node --test --experimental-strip-types lib/crm/domain/quote-document.test.ts` 통과
의존: I02

### I04 견적서에 직인을 찍는다
상태: 대기
모드: 경량
범위: apps/web/app/(crm)/crm/quotes/[id]/QuoteSheet.tsx, apps/web/app/(crm)/crm/quotes/[id]/QuoteDocumentView.tsx, apps/web/app/(crm)/crm/quotes/[id]/quote-document.module.css
감사 기준:
- 직인이 있으면 상호 옆에 `<img>`, 없으면 `QUOTE.sealOmitted` — 둘이 동시에 뜨지 않는다
- 인쇄·PDF 에서도 같다 (`@media print` 에서 직인이 안 사라진다)
- `alt` 는 `QUOTE.seal` — 그림이 안 뜨는 자리에서도 무엇인지 읽힌다
의존: I03

### I05 엑셀에도 직인이 들어간다
상태: 대기
모드: 경량
범위: apps/web/lib/crm/services/quote-xlsx.ts
감사 기준:
- 직인을 올린 상태로 엑셀을 내려받으면 공급자 칸에 그림이 박힌다
- 안 올렸으면 「(직인생략)」 글자가 그 자리에 남는다
- `node --test --experimental-strip-types lib/crm/services/quote-xlsx.test.ts` 통과
의존: I03

### I06 실브라우저로 눈으로 본다
상태: 대기
모드: 경량
범위: apps/web/e2e/quote-seal.spec.ts (신규), apps/web/package.json
감사 기준:
- 격리 dev 서버(판 번호가 HEAD 와 같은지 먼저 확인)에서 설정에 PNG 를 올리고 새 견적을 만들면 직인이 찍힌다
- 설정에서 지우면 그 뒤 만든 견적은 「(직인생략)」이고, 앞서 만든 견적은 직인이 그대로다
- 시험에 쓴 데이터는 id 로 되돌린다
의존: I04, I05

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-21) 최초 작성 (ins_0055)
