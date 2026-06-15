# 00 요구사항 — xlsx/임의 카탈로그 AI 자동 흡수 (MVP)

## 배경
경쟁사/공급사가 GPU 카탈로그·견적표를 xlsx/csv 파일로 제공한다. 컬럼명·순서가 제각각이다.
현재 통합입력은 텍스트/이미지/고정별칭 CSV만 받아 xlsx를 흡수 못 한다.
AI·DB스키마·service_role이 모두 있으므로 "임의 표 → 우리 스키마 자동 매핑·적재"는 기술적으로 가능 = 미구현이었다.

## 사용자 종료조건 (반드시 충족)
1. 실제 `gcube_csp_catalog_spheron_2026_0603.xlsx`(184행)를 UI 업로드 → AI 헤더매핑 → 184행 변환 → 검토대기 적재까지 브라우저 검증
2. 검토대기 항목 실제 승인 → competitors + market_prices 반영 검증
3. AI가 프롬프트를 바꿔가며 일하는 것(매핑 프롬프트 + 미준비형식 자가합성) 실증
4. 다각도 테스트(정상/컬럼뒤섞기/단위·통화 모호)

## 기능 요구
- FR1: xlsx·csv 업로드(서버 파싱). 첫 시트, 단일 헤더행 정형표 지원(MVP 범위).
- FR2: AI가 헤더+샘플 → 우리 필드 매핑 JSON 1회 생성. 코드가 전체 행 결정적 변환.
- FR3: location 복합값("vendor/region") 분리, gpu_name→표준모델(specContext), price→price_usd, spot→pricing_model.
- FR4: 변환 결과를 검토대기(review_items, target=competitor, channel=catalog)에 적재. 자동반영 금지.
- FR5: 검토대기 승인 시 saveCompetitorPrices로 competitors+market_prices 반영.
- FR6: 매핑 실패(미준비 형식) 시 AI가 매핑 프롬프트 자가합성 후 재시도(거버넌스 경유).

## 비기능 요구
- NFR1(보안): 파일업로드 크기·시트 제한, CSV 수식인젝션 무력화(sanitizeCell 재사용), 매핑 필드 화이트리스트, AI 반환값 검증.
- NFR2(정합): 가격범위/enum 검증(validate.ts) 통과분만 적재. 단위·통화 사용자 확인 가능.
- NFR3(격리): is_test 플래그 → 테스트는 검증 후 revert, 운영 가격DB 오염 0.
- NFR4(SSOT): dedup/validate/tier-dict/normalize/saveCompetitorPrices/extract-helpers 재사용. 복붙 금지.
- NFR5(회귀0): 기존 supplier 경로 무수정 보존.

## 제외 범위 (MVP 아님)
- 다중시트·병합셀·다중헤더·합산행 자동처리 (단일 헤더 정형표만)
- 완전자동 적재(확인 없이) — 검토대기 게이트 필수
- 저장된 매핑 재사용/패턴기억 (2단계)
- PDF/이미지 카탈로그 (기존 이미지 경로 별도)
