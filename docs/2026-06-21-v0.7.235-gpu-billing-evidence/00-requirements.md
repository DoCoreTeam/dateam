# 00 Requirements — GPU 검토대기 정합성·재분석·과금구조·원본보관

## 배경 / 문제 (코드 진단 확정)
1. **재분석 결과 부재**: `ReviewTab.handleRecheck`가 recheck 응답(`{item, extracted, iteration}`)을 버리고 숫자만 갱신 → "무엇이/왜 바뀌었는지" 리포트 0.
2. **환산 정합성 버그**: AI가 환산을 하드코딩 환율(KRW÷1370, 월÷730)로 수행 — SSOT `normalize-money.ts`(월÷720, 주입 매매기준율 1,523)와 불일치. 결과 3.17 USD/hr이 실제 매매기준율 기준 ≈2.91과 어긋남(단가 오저장).
3. **설치비+월과금 미수용**: `supply_quotes`에 setup_fee/monthly/billing_model 컬럼 없음 → "설치비 따로+월단가 따로"(스마일서브 RTX Pro 6000) 입력 시 설치비 소실/왜곡.
4. **원본 미보관**: 업로드 xlsx/pdf/img가 Gemini 소비 후 소멸. `evidence_drive_file_id` 컬럼은 있으나 항상 null. Drive 인프라(lib/google-drive.ts)는 명함에만 배선.

## 사용자 요구 (확정)
- 종료조건: 전체(①+②+③) + 브라우저 실확인
- 재분석 UX: **변경 전/후 diff + 근거 텍스트**

## 기능 요구
- FR1: 재분석 시 변경된 필드의 before→after + AI 근거(change_summary)를 카드에 표시
- FR2: 단가 산출 근거(원본가→환율→시간환산→장수→USD/장·hr) 표시, SSOT 환율·720h 정합
- FR3: 설치비(setup_fee_krw)·월단가(monthly_price_krw)·billing_model 저장/표시
- FR4: 업로드 원본을 Drive에 보관, supply_quotes.evidence_drive_file_id로 역추적
- FR5: Drive 미연결 환경에서 graceful degrade

## 비기능 요구
- 기존 가격 정합성 회귀 0 (pricing.ts 계산식은 단일 단가 유지, 설치비는 표시·보존 우선)
- RLS 유지, service_role 경로 보존
- 신규 의존성 0, 디자인 토큰/폼 클래스 표준 준수
- 운영 데이터 오염 0 (is_test/throwaway)

## 범위 제외
- 고객 발행 견적서(quote document) 라인아이템 생성 — 별도 과제(설치비 보존까지만)
- 비KRW(JPY/EUR) 설치비 — 1차는 KRW/USD만
