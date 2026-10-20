# PLAN newAX: 견적 다른 안의 판 표시와 뱃지 배치
플랜 ID: P0143
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0289
목표 버전: v0.11.32
푸시: 즉시
작성: 2026-10-20
시작 커밋: b2212558

## 목표
- 다른 안은 새 문서라 Rev.1 에서 시작, 원본의 Rev.2 를 물려받지 않음 (목록과 견적서 둘 다)
- 다른 안 제목에 안 이름을 덧붙이지 않음, 안 이름은 뱃지 하나로만 보임 (「(gcube edge) (2안)」 겹침 없음)
- 딜 견적 카드 윗줄은 번호 옆에 판과 안 뱃지가 붙고 상태 뱃지만 오른쪽 끝, 기본 안 이름은 이미 있는 안 수로 셈

## 범위 밖
- 견적 목록 화면(QuoteListView) 배치, 이미 왼쪽으로 붙어 있음
- 개정 흐름(Rev 올리기) 변경

## 완료 정의
- pnpm typecheck, pnpm test 통과
- 실브라우저에서 딜 화면 견적 카드 윗줄 확인
- 운영 데이터 두 줄(DA-2026-1020-01, -02) 판과 제목 보정, 되돌리는 SQL 기록

## 참조
- 실측 2026-10-20 DA-2026-1020-01 revision 2 variantLabel gcube edge, -02 revision 2 제목 (gcube edge) (2안)
- lib/crm/services/quote.ts duplicateQuote, components/ui/crm/QuotePanel.tsx

## 항목

### I01 다른 안의 판 번호와 제목을 순수 함수로
상태: 통과
모드: 경량
범위: lib/crm/domain/quote-duplicate-identity.ts (신규), lib/crm/domain/quote-duplicate-identity.test.ts (신규), lib/crm/services/quote.ts, package.json
감사 기준:
- 보안: 해당 없음 근거, 새 저장 칸 새 창구 없음, 안 이름은 기존처럼 normalizeText 를 지남
- 시험: 다른 안은 revision 1, 제목은 원본 제목에서 원본 안 이름 꼬리를 뗀 값, 개정은 revision+1 에 제목 그대로
- duplicateQuote 가 그 함수를 부름 (grep 으로 호출 자리 1곳 이상)
- pnpm test 통과
의존: 없음

### I02 견적 카드 윗줄 배치와 기본 안 이름
상태: 통과
모드: 경량
범위: components/ui/crm/QuotePanel.tsx, components/ui/crm/quote-panel.module.css
감사 기준:
- 보안: 해당 없음 근거, 화면 배치와 입력 기본값만 바뀜
- 1280 과 390 폭 실브라우저에서 번호 옆에 Rev 와 안 뱃지, 상태 뱃지 오른쪽 끝, 넘침 0
- 다른 안 만들기 창의 기본 이름이 딜 안의 안 수+2 (안 이름 없는 원본이 1안)
- pnpm typecheck 통과, 화면 표준 가드 포함 pnpm test 통과
의존: I01

### I03 운영 데이터 두 줄 보정
상태: 통과
모드: 경량
범위: 운영 DB crm_quote 두 줄 (코드 변경 없음)
감사 기준:
- 보안: 해당 없음 근거, 두 줄 UPDATE, 되돌리는 SQL 을 pass --notes 에 적음
- DA-2026-1020-01 과 -02 의 revision 1, 제목 「숙명여대 교수 연구용 gcube 도입 견적」, select 로 확인
의존: I01

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-10-20) 최초 작성 (ins_0289)
