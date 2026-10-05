# PLAN newAX: 금액 축이 날짜 없이 수량에서도 선다
플랜 ID: P0111
플랜 버전: v0.1.1
상태: 진행중
지시: ins_0193
목표 버전: v0.10.922
작성: 2026-10-05
시작 커밋: 43b1ecb4

## 목표
- 금액 표시를 체크하면 견적서에 실제로 그 줄이 선다, 품목에 기간을 안 적었어도 선다
- 수량이 시간인 줄은 총 시간·시간당·월 금액을 수량과 단가에서 되짚는다 (1,440 Hours 1,388원 720시간 기준 2개월 999,360원)
- 기간 총액은 품목 금액 그 자체이므로 아무 근거도 요구하지 않는다
- 그래도 못 그리는 선택은 모달이 왜 못 그리는지 말한다

## 범위 밖
- 매입 자료에 월 기준 시간을 맞추는 일 (매입에 맞춤 선택지는 지금도 비활성)
- 품목 기간 입력 칸의 모양이나 검증 변경
- 저장 경로 변경, 금액 계산 변경 (합계는 한 원도 안 바뀐다)

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 사용자 노출 문자열은 전부 lib/terms 상수
- 설정값은 env 추가 없이 DB 저장 + UI 관리 (해당 시)
- 실브라우저에서 DA-2026-1003-01 견적서에 총 시간 시간당 월 금액이 보인다

## 참조
- LOOP.md 9절 U-N F-N
- apps/web/lib/crm/domain/quote-rate.ts 머리 주석 (무엇이 진짜 값이고 무엇이 파생인가)
- apps/web/lib/crm/domain/quote-rate-text.ts 머리 주석 (글 짓는 자리는 한 곳)
- 실측 근거: crm_quote cmus4n1le0001js04vg8zjax1 의 rateAxisKeys 는 채워졌고 품목 startDate endDate 는 NULL

## 항목

### I01 시간 축을 수량에서도 되짚는다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/domain/quote-rate.ts, apps/web/lib/crm/domain/quote-rate.test.ts
감사 기준:
- hoursFromQuantity 가 단위 Hours h hr 시간 에 수량 1440 을 주면 1440 을 돌려주고 단위 식 User 에는 null 을 돌려준다
- rateFromHours(1998720, 1440, 720) 가 totalHours 1440 months 2 monthlyMinor 999360 hourlyMinor 1388 hourlyExact true 를 돌려준다
- 나누어떨어지지 않는 시간(1000시간 720기준)에는 months 가 null 이고 monthlyMinor 도 null 이다
- node --experimental-strip-types --test lib/crm/domain/quote-rate.test.ts 통과
보안: 해당 없음 (새 표 없음, 새 라우트 없음, 저장된 수치만 읽는 순수 계산)
의존: 없음

### I02 문서가 기간 없이도 환산을 싣는다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/domain/quote-document.ts, apps/web/lib/crm/domain/quote-document.test.ts
감사 기준:
- 품목에 startDate endDate 가 없고 unit Hours quantity 1440 unitPriceMinor 1388 lineTotalMinor 1998720 rateHoursPerMonth 720 일 때 line.rate 가 null 이 아니고 totalHours 1440 months 2 start null end null 이다
- 같은 입력에서 totals.conv 가 null 이 아니고 totalHours 1440 months 2 이다
- 기간이 있는 기존 입력의 값이 안 바뀐다 (2026-10-07 ~ 2026-12-06 730기준 1460시간 그대로)
- 단위가 시간이 아니고 기간도 없으면 line.rate 가 여전히 null 이다
- node --experimental-strip-types --test lib/crm/domain/quote-document.test.ts 통과
보안: 해당 없음 (순수 조립, 밖에서 온 값 없음)
의존: I01

### I03 기간 총액은 근거를 요구하지 않는다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/domain/quote-rate-text.ts, apps/web/lib/crm/domain/quote-rate-text.test.ts (신규)
감사 기준:
- line.rate 가 null 이어도 total 축을 고르면 axisTexts 가 기간 총액 한 줄을 돌려준다
- line.rate 가 null 일 때 monthly hourly 를 골라도 그 줄은 안 생긴다
- node --experimental-strip-types --test lib/crm/domain/quote-rate-text.test.ts 통과
- apps/web/package.json 의 test 스크립트에 이 파일이 등재되어 전체 시험 수가 실제로 는다
보안: 해당 없음 (글 짓기만 함)
의존: 없음

### I04 모달 안내가 사실을 말한다
상태: 통과
모드: 경량
범위: apps/web/lib/terms/quote.ts, apps/web/components/ui/crm/QuoteTotals.tsx, apps/web/components/ui/crm/quote-draft-shape.ts, apps/web/lib/ui/quote-layout.test.ts
감사 기준:
- 수량이 시간인 줄이 있으면 기간이 없어도 시간당과 월 금액을 못 쓴다고 말하지 않는다
- 기간도 없고 수량도 시간이 아니면 시간당과 월 금액을 못 그린다고 말한다
- 안내 문구는 전부 lib/terms 상수이고 화면에 한글 문자열을 직접 안 적는다
- pnpm test 의 용어집 가드와 quote-layout 가드 통과
보안: 해당 없음 (문구와 표시 조건만)
의존: I02

### I05 화면과 엑셀이 같은 것을 말한다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/services/quote-xlsx.test.ts, apps/web/lib/ui/quote-layout.test.ts
감사 기준:
- 기간 없는 시간 품목으로 만든 문서에서 엑셀 글에 총 시간 1,440h 와 시간당 금액 1,388원 × 1,440h 와 월 금액 999,360원 × 2개월 이 다 있다
- 같은 문서에서 기간 근거 줄은 없다 (날짜를 모르므로 지어내지 않는다)
- pnpm test 통과
보안: 해당 없음
의존: I02, I03

### I06 실브라우저로 끝까지 본다
상태: 통과
모드: 경량
범위: 없음 (확인만)
감사 기준:
- 로컬 운영 판에서 DA-2026-1003-01 견적서를 열어 품목 아래에 총 시간 1,440h 월 기준 시간 720h 가 보인다
- 같은 화면 금액 칸에 기간 총액 1,998,720원 월 금액 999,360원 × 2개월 시간당 금액 1,388원 × 1,440h 가 보인다
- 합계 금액이 2,198,592원 그대로다 (한 원도 안 바뀐다)
- 안 고른 것은 안 그려진다: totalConvKeys 가 빈 목록이므로 합계 영역에 월 환산과 시간당 환산 줄이 없다
- 고른 것도 셀 근거가 없으면 안 그려진다: 기간을 골랐지만 날짜가 없으므로 기간 근거 줄이 없다
- 수정 모달의 안내가 기간 줄만 못 쓴다고 말한다 (시간당과 월 금액을 못 쓴다고 하지 않는다)
보안: 해당 없음
의존: I04, I05

### I07 월 기준 시간 선택지가 실제로 바뀌는 것을 보여 준다
상태: 대기
모드: 경량
범위: apps/web/lib/terms/quote.ts, apps/web/lib/terms/index.ts, apps/web/components/ui/crm/QuoteTotals.tsx, apps/web/lib/ui/quote-layout.test.ts
감사 기준:
- 수량이 센 시간일 때 730시간과 720시간 옆에 같은 숫자가 서지 않는다
- 그때 옆에 서는 것은 개월이다 (720 은 2개월, 730 은 개월이 안 맞는다고 말한다)
- 기간이 있을 때는 지금처럼 시간당 환산값이 선다
- 아래 안내 문장도 무엇이 달라지는지를 경우에 맞게 말한다
- 문구는 전부 lib/terms 상수
- 가드를 일부러 깨 실패를 확인하고 되돌린다
보안: 해당 없음 (문구와 미리보기 표시만)
의존: I06

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-10-05) 최초 작성 (ins_0193)
- v0.1.1 (2026-10-05) I06 실측에서 둘 발견: 수정 모달의 체크를 풀어 저장하는 확인은 사용자 실데이터를 고치는 일이라 읽기만 하는 반대 증거(안 고른 것과 셀 근거 없는 것이 안 그려짐)로 바꿨고, 730과 720 옆 미리보기가 둘 다 1,388원으로 같아져 아래 안내문이 거짓이 되는 것을 I07 로 추가 (audit:I06)
