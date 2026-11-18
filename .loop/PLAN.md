# PLAN newAX: 견적서 거래 조건을 견적마다 고치고 머리 칸 글자가 안 겹친다
플랜 ID: P0186
플랜 버전: v0.1.1
상태: 진행중
지시: ins_0511
목표 버전: v0.11.111
푸시: 즉시
작성: 2026-11-18
시작 커밋: a87ab8fd

## 목표
- 견적 편집 화면과 PATCH /quotes/{id}(crm quote update)에서 그 견적의 거래 조건 문구를 줄마다 고치고 지울 수 있다, 조회 문서 PDF 엑셀이 저장된 문구를 그대로 낸다
- 견적서 머리 칸(견적번호 유효기간 사업자등록번호)은 라벨 길이에 맞춰 칸이 늘어 글자가 값 위로 넘치지 않는다
- 엑셀의 담당자 칸이 숨긴 할인 열 위에서 잘리거나 겹치지 않는다

## 범위 밖
- 금액과 견적 항목 계산, 기준 견적 DA-2026-1110-01 의 금액과 항목은 건드리지 않음
- 공급자 기본 조건 설정 화면, 새 견적의 첫 값으로만 쓰는 지금 동작 그대로
- PDF 글꼴을 가변 글꼴에서 고정 글꼴로 바꾸는 일 (Type3 로 박히는 것), 표준 렌더러 넷에서 겹침이 재현되지 않아 이번 원인이 아님

## 완료 정의
- pnpm typecheck, pnpm test, pnpm build 통과
- 사용자 노출 문자열은 전부 lib/terms 키 사용
- crm quote update 로 보낸 termsSnapshot 이 GET 견적, document, PDF 에 같게 나오고 CLI 종료 코드 9 가 안 남
- 기준 견적 PDF 머리와 엑셀 담당자 칸을 이미지로 확인

## 참조
- docs/cli/02-기능대응표.md
- apps/web/lib/crm/services/quote-terms-snapshot.test.ts
- 실측 2026-11-18 운영 PDF 를 Quick Look MuPDF poppler 운영 PNG 넷으로 그려 겹침 없음, 사업자등록번호 라벨 79px 가 고정 칸 88px 에 9px 여유, 나눔고딕이면 86px
- 실측 2026-11-18 운영 엑셀 F 열(할인) 숨김, 담당 값이 F14:G14 병합이라 보이는 폭은 G 21, 행 높이 계산이 칸 용량을 폭x2-2 로 잡아 두 배 과대

## 항목

### I01 거래 조건 문구를 견적마다 저장하고 그대로 인쇄
상태: 통과
모드: 경량
범위: apps/web/lib/crm/services/quote.ts, apps/web/lib/crm/services/quote-document.ts, apps/web/lib/crm/domain/quote-document.ts, apps/web/lib/crm/services/quote-terms-snapshot.test.ts, apps/web/lib/terms/quote.ts, apps/web/lib/actions/generated/ packages/teamda-cli/src/generated/spec.json
감사 기준:
- 보안: termsSnapshot 은 밖에서 온 값, 문자열만 받고 줄 수 30 줄당 500자 상한을 넘으면 VALIDATION_FAILED, 문서는 문자열로만 그려 HTML 로 해석되지 않음
- pnpm test 에서 quote-terms-snapshot 시험 통과, PATCH 가 termsSnapshot 을 data 에 싣는 단정과 굳은 견적은 빈 목록도 그대로 인쇄하는 단정 포함
- node --experimental-strip-types scripts/cli-parity-check.mjs 통과, openapi.json 의 crm.quote.update 입력에 termsSnapshot 이 있음
- cd apps/web && node --experimental-strip-types --test lib/actions/parity.test.ts 통과
의존: 없음

### I02 견적 편집 화면에서 거래 조건을 줄마다 고치고 지우기
상태: 대기
모드: 경량
범위: apps/web/components/ui/crm/QuoteEditorModal.tsx, apps/web/components/ui/crm/quote-draft-shape.ts, apps/web/lib/terms/quote.ts
감사 기준:
- 보안: 해당 없음 근거 새 창구 없음, 값은 I01 의 PATCH 가 검사
- 편집 화면 거래 조건 접이에 줄마다 글 칸과 삭제 단추, 줄 추가 단추가 있고 저장하면 PATCH 본문에 termsSnapshot 이 실림
- 새 문구는 lib/terms/quote.ts 키, product-copy native-dialog 가드 통과
- pnpm typecheck 통과
의존: I01

### I03 견적서 머리 칸이 라벨 길이에 맞춰 늘어남
상태: 대기
모드: 경량
범위: apps/web/app/(crm)/crm/quotes/[id]/quote-document.module.css
감사 기준:
- 보안: 해당 없음 근거 CSS 만 바꿈
- 당사자 칸 라벨 열이 minmax 로 라벨 길이만큼 늘고 라벨은 줄바꿈 안 함, 머리 칸 라벨과 값 사이 간격이 넓어짐
- 실브라우저에서 글꼴을 나눔고딕 AppleMyungjo 로 바꿔도 라벨 오른쪽 끝이 값 왼쪽 끝보다 왼쪽
- pnpm test 화면 가드 통과
의존: 없음

### I04 엑셀 담당자 칸이 숨긴 할인 열 위에서 안 잘림
상태: 대기
모드: 경량
범위: apps/web/lib/crm/services/quote-xlsx.ts, apps/web/lib/crm/services/quote-xlsx.test.ts
감사 기준:
- 보안: 해당 없음 근거 파일 조립만 바꿈
- 행 높이 계산이 칸 용량을 열 폭 그대로 쓰는 단정, 할인 없는 견적의 담당 값 칸이 보이는 열에서 시작하는 단정
- pnpm test 에서 quote-xlsx 시험 통과
- 기준 견적 엑셀을 LibreOffice 로 그려 담당자 칸과 할인 칸이 안 겹침
의존: 없음

### I05 운영 판으로 처음부터 끝까지 확인
상태: 대기
모드: 경량
범위: 없음 (확인만)
감사 기준:
- 보안: 해당 없음 근거 확인만
- 로컬 운영 판에서 시험 견적 하나의 거래 조건을 화면에서 고치고 지운 뒤 GET document 와 PDF 에 같은 줄이 나옴, CLI 와 같은 PATCH 로 보낸 값이 저장값과 같음
- 기준 견적 DA-2026-1110-01 은 쓰지 않고 금액 항목이 그대로임(version 18)
의존: I01 I02 I03 I04

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-11-18) 최초 작성 (ins_0511)
- v0.1.1 (2026-11-18) I01 범위에 용어 파일 추가(서버 오류 문구가 lib/terms 키), 대응표는 생성 줄이 이미 CLI됨이라 변경 없음 (audit:I01)
