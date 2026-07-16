# 완료 기준 — v0.7.333 P0 (GPU 통합입력 데이터 안전)

## 이번 루프 스코프 (P0 + 테스트) — 달성
- [x] P0-1 통화 보류: 감지된 비USD·비KRW(JPY/EUR/CNY)는 price_usd=null(보류). ¥30,000→$30,000 둔갑 차단. (transcription-to-items.ts)
- [x] P0-1b '円'(일본어 엔 한자) 통화 감지 갭 봉합 — CURRENCY_TOKENS 등록. (normalize-money.ts)
- [x] P0-2 저장 게이트: saveCompetitorPrices가 validateCompetitorItem(looksLikeGpuModel+PRICE_HARD) 통과 강제, 실패=rejected 격리(저장 거부). 3개 호출처(confirm/import/refresh) 자동 방어. (competitor-import.ts + 호출처)
- [x] P0-3 DB 최종 방어: market_prices.price_usd CHECK(0<p≤1000) NOT VALID(기존행 보호). (마이그 162)
- [x] 단위테스트: 통화 보류(JPY/円/EUR/CNY) + 게이트 배선 정적검증. 985/985 통과.
- [x] tsc --noEmit 0, design:check 통과.

## 검증 결과
- [x] 전체 985 테스트 통과 (신규 6케이스 포함)
- [x] tsc 0 에러 / design 토큰 가드 통과
- [ ] 🟥 DC-QA / 🟥 DC-SEC / 🟥 DC-REV (진행 중)
- [ ] GATE 1-5

## 배포 주의 (수동)
- 마이그 162는 `PGPASSWORD=... ./scripts/migrate.sh 162_market_prices_price_guard.sql`로 배포 시 적용 필요. NOT VALID이라 무중단·기존행 안전. (코드 P0-1·P0-2는 마이그 없이도 동작 — 마이그는 DB 백스톱)

## 후속 루프 (스코프 밖 — 별도)
- P1-2 미리보기 게이트 배지(review/stream + QuoteRegisterTab): 사용자 "버그 오인" 제거
- P1-1 미리보기 resolveProductId 프리뷰(매칭/미지 배지)
- P2 held큐 통일·own_target SSOT 수렴·market-median 이상치 방어·USAI 게이트 복원
- 별도: 번들 서비스 페이지(소프트뱅크류) 적합성 판정·시세 격리
- 통화 정식 환산(fx_rates 다통화 확장 → toUsdPerGpuHour JPY/EUR/CNY 지원)
