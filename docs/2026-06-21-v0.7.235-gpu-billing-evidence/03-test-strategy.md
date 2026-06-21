# 03 Test Strategy

## 단위 (node --test, package.json test 목록에 등재 필수)
- extract-diff.test.ts: 값 변경/추가/삭제/동일 → diff 정확. 숫자 vs 문자열 비교. 무변경 시 빈 배열.
- price-breakdown.test.ts: 3,189,800 KRW/month ÷1523 ÷720 ×(1/1장) ≈ 2.91 USD/hr. 통화/기간/장수 조합. normalize-money와 동일값.
- billing-parse.test.ts: billing_model 분기, setup_fee/monthly 보존, hourly 단일가 회귀.

## 통합
- recheck 라우트 응답 형태(change_summary, diff) 계약 — mock Gemini 응답으로 diff 경로.

## E2E (Playwright, throwaway 계정 + is_test)
- ① 재분석: review 항목에 피드백 입력→AI 재분석→"재분석 결과" 패널에 before→after + 근거 노출 확인(스크린샷).
- ② 설치비: 설치비+월과금 텍스트 통합입력→검토대기에 설치비/월단가 분리 표시 확인.
- ③ 원본: 파일 업로드→검토대기 "원본 보기" 링크 존재(또는 Drive 미연결 경고) 확인.
- 정리: is_test 행 삭제, throwaway 계정 정리.

## 회귀 게이트
- 기존 437+ 테스트 그린 유지.
- pricing.ts 단일단가 계산 회귀 0 (설치비 추가가 effective_unit_price_usd 변경 안 함).
- design:check 통과. next build(React18) 통과.

## 검증 원칙
- 정적(tsc/lint)만으로 완료 선언 금지 — 실제 렌더 경로(ReviewTab) 브라우저 확인 필수.
