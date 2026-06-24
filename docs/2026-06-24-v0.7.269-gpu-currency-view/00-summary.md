# GPU 통화 뷰 — 행별 원본통화 기준 표시 — v0.7.269
작업: 가격 표시를 "각 행의 원본 통화가 진실"로. 뷰 통화(원/달러)와 같은 행은 원본 그대로, 다른 통화 행만 fx 환산.
변경:
- lib/gpu/format-price.ts: fmtMoneyFromOriginal(originalCurrency, originalPrice, priceUsd, mode, usdKrw) SSOT 추가(+테스트 6케이스, package.json 등록)
- app/api/pricing/gpu/market/route.ts: market_prices select에 original_currency·original_price 추가 + MarketEntry 빌드 전달
- tabs/MarketTab.tsx: MarketEntry에 원본통화 필드, fmtOrig 생성·AnalyzePanel 전달, 경쟁사 가격 렌더를 fmtOrig로(원/달러 토글 시 행별 원본 기준)
- lib/gpu/confirm-review-item.ts: 확정 시 original_currency·original_price를 saveCompetitorPrices로 전달(staging→market_prices 보존)
이유: 원으로 들어온 행은 원 보기에서 원 그대로(round-trip 손실0), 달러 보기에서 환산. 달러 행은 반대. 사용자: "원본이 기본/진실, 뷰통화 다르면 계산".
영향: GPU 시장/콕핏 경쟁사 가격 표시. price_usd(비교용 정규화) 유지. 기존행(original_currency NULL)=USD 가정 폴백.
