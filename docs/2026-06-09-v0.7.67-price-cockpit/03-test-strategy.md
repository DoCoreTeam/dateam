# 03 Test Strategy

## 단위
- price-signal: marginSignal(5→danger, 20→ok, 30→over), deviationSignal(-15→cheap, 0→ok, +15→expensive) 경계
- format-price: fmtKRW/fmtUSD 반올림·통화기호·널 처리
- buildCatalog: strategic_price_krw 있으면 strategic_krw=그값·is_strategic_set=true / 없으면 auto_margin_krw fallback·false. effective_margin_pct/market_deviation_pct 계산 정확. 기존 sell_price_krw 불변(회귀)

## 통합(API)
- PATCH strategic-price set → strategic_price_krw 저장 + audit('strategic_price_set') + revalidate. clear(null) → 자동마진가 복귀
- admin 아닌 사용자 → 403
- catalog가 strategic_krw 출력하는지

## E2E (Playwright, throwaway)
- 콕핏 탭: 한 행에 원가·자동마진가·전략가·시장중앙·실효마진·시장편차 동시 표시
- 전략가 연필 클릭 → 인라인 편집 → 저장 → 같은 행 실효마진/시장편차 즉시 갱신 + 고객판매가표 반영(cascade)
- 미입력 전략가 = 자동마진가 흐림 표시
- 3색 시그널 노출
- 장황 카피 부재 확인(188/719/750/1022 문구 안 보임)
- 반응형 768/1024 table-card

## 게이트
- npx tsc --noEmit -p apps/web/tsconfig.json = 0
- node scripts/check-design-tokens.mjs PASS (하드코딩 0)
- npm test PASS

## 격리
throwaway 모델([TEST]) 사용, 운영 전략가 실데이터 오염 금지, 종료 후 정리
