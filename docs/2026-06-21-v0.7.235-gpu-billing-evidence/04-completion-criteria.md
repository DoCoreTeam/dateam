# 04 Completion Criteria

## ① 재분석 리포트 + 환산 정합성
- [ ] recheck 응답에 change_summary + diff 포함
- [ ] ReviewTab 재분석 후 "재분석 결과" 패널: 필드별 before→after + AI 근거 표시
- [ ] 단가 행에 산출 근거(원본가→환율→시간환산→USD/장·hr) 표시
- [ ] price-breakdown이 normalize-money SSOT(720·주입fx) 기준 — 하드코딩 1370/730 제거 또는 정합단가 병기
- [ ] extract-diff / price-breakdown 단위테스트 통과

## ② 설치비+월과금
- [ ] 마이그레이션 126 적용(supply_quotes setup_fee_krw/monthly_price_krw/billing_model, NULL 허용)
- [ ] 추출 스키마/프롬프트에 신규 3필드
- [ ] confirm 시 신규 필드 저장(소실 0)
- [ ] ReviewTab에 설치비/월단가 분리 표시(billing_model=one_time_plus_monthly)
- [ ] hourly 단일가 기존 동작 회귀 0

## ③ 원본 Drive 보관
- [ ] 업로드 원본이 Drive(AX사업본부/GPU견적)에 저장되고 file_id 획득
- [ ] supply_quotes.evidence_drive_file_id에 연결 저장
- [ ] ReviewTab/HistoryTab "원본 보기" 링크
- [ ] Drive 미연결 시 graceful degrade(추출 정상, 경고)

## [Feature Defaults] (신규 컬럼만, 신규 테이블 아님 → 축약)
- [ ] 신규 컬럼 RLS/권한: supply_quotes 기존 service_role 쓰기 정책 유지
- [ ] 입력 검증: billing_model CHECK, 금액 numeric/양수 가드

## 시스템
- [ ] DC-QA / DC-SEC(CRIT 0) / DC-REV 80+
- [ ] GATE 1-5: tsc 0 / lint 0 / test 그린 / next build ✅ / design:check ✅
- [ ] Playwright E2E ①②③ 실화면 확인 + 스크린샷, throwaway/is_test 정리
- [ ] 버전 0.7.235 (4파일) + git commit (push 금지)
