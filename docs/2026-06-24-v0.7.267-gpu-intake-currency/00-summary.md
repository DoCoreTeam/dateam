# GPU 통합입력 통화 원본보존 — v0.7.267

## 작업
통합입력 경쟁사 경로가 입력 통화(원/달러)를 강제 USD 변환 저장하던 버그 제거.
원본 통화·금액 무손실 보존 + 표시는 fx_rates 실환율로 환산. 하드코딩 1370 제거.

## 변경 (W1-W5)
- W4: supabase/migrations/134_market_prices_original_currency.sql — market_prices에 original_currency·original_price ADD(additive). 미적용=CEO 검증 후.
- W2: lib/gpu/transcription-to-items.ts — parsePriceToken 통화감지(resolveCurrency), CompetitorCandidate에 original_currency·original_price 보존, krwPerUsd 주입 시 toUsdPerGpuHour로 USD 파생.
- W3: review/stream/route.ts — fx_rates 최신 usd_krw 주입, 원본보존 전달.
- W1: review/route.ts CLASSIFY_PROMPT — 1370 제거, AI는 original_price+original_currency만 반환, 서버가 실환율 환산.
- W4b: competitor-import.ts — market_prices INSERT에 original_currency·original_price 저장.
- W5: 경쟁사 가격 표시 — original_currency 기준 + fx_rates 환산(format-price 재사용), 기존행 USD 가정 폴백.

## 이유
경쟁사 경로만 버그(공급가·USAI는 이미 원본보존). AI 프롬프트 1370 하드코딩 + 스트림 통화무시(₩2.4M→USD 오적재) + market_prices 통화컬럼 부재 3중 결함.

## 영향
- GPU 경쟁사 통합입력 경로만. 공급가·USAI 무수정(회귀0). 콕핏 비교용 USD 정규화 유지.
- DB additive 컬럼 1개. 기존 행은 USD 가정.

## 완료조건
- [ ] 원/달러 양쪽 무손실 보존 + fx_rates 표시환산
- [ ] tsc·단위테스트·design:check 통과 + DC-QA/SEC/REV
- [ ] 마이그레이션 파일 작성(적용은 CEO 검증 후)

## 설계 결정(사용자)
- 원본 무손실 + 우리 fx_rates로 표시환산. 비교용 USD 실환율 파생 병행.
- 기존 market_prices = USD 가정 표기, 그대로 둠.
