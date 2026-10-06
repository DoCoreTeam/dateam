# PLAN newAX: 견적서 수신 담당자에 경칭을 붙인다
플랜 ID: P0116
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0202
목표 버전: v0.10.950
작성: 2026-10-06
시작 커밋: cfc19e2a

## 목표
- 견적서 「공급받는자」 담당자 칸이 「강명구 부장님」처럼 경칭까지 적힌다
- 화면·인쇄·엑셀 셋이 같은 이름을 적는다 (문서 모델 한 자리에서 붙이므로)
- 공급자(우리) 담당자에는 안 붙는다, 제 이름에 님을 붙이는 문서를 보내지 않는다

## 범위 밖
- 공급자 담당자 표기 변경
- 회사명 뒤 「귀중」 변경
- 견적 편집기의 담당자 고르기 화면

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 사용자 노출 문자열은 전부 lib/terms 경유
- 설정값 추가 없음

## 참조
- apps/web/lib/terms/quote.ts (말의 SSOT)
- apps/web/lib/crm/domain/quote-document.ts (문서 모델 SSOT)

## 항목

### I01 수신 담당자 이름에 경칭을 붙인다
상태: 통과
모드: 경량
범위: apps/web/lib/terms/quote.ts, apps/web/lib/crm/domain/quote-document.ts, apps/web/lib/crm/domain/quote-document.test.ts
감사 기준:
- pnpm test quote-document 통과, 「강명구 부장」 입력 시 doc.customer.personName 이 「강명구 부장님」
- 이미 「님」으로 끝나는 이름은 두 번 안 붙음 (단정 추가)
- personName 이 비면 null 그대로, 경칭만 남지 않음 (단정 추가)
- doc.owner.name 에는 경칭이 안 붙음 (단정 추가)
- 보안: 7절 세 질문 셋 다 아니오 (저장 없음·창구 없음·새 외부 입력 없음), 순수 표시 변환이라 닿는 자리 없음
의존: 없음

### I02 화면과 엑셀이 같은 이름을 적는지 본다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/services/quote-xlsx.test.ts
감사 기준:
- pnpm test quote-xlsx 통과, 엑셀 담당자 칸 값이 문서 모델의 personName 과 같음
- 화면(QuoteSheet)과 엑셀이 doc.customer.personName 을 그대로 쓰는지 코드에서 확인 (가공 자리 0곳)
- 보안: 해당 없음, 시험 파일만 변경
의존: I01

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-10-06) 최초 작성 (ins_0202)
