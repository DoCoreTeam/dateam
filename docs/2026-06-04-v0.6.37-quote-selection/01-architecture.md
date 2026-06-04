# 아키텍처
- SSOT: lib/gpu/pricing.ts buildCatalog — 모든 메뉴가 effective/sell 읽음.
- DB(054): supply_quotes.price_type('cost'|'list') + is_selected(boolean, 상품당 1 partial unique).
- 계산: cost만 풀 구성 → 채택 우선 → 없으면 자동최저 → cost 전무 시 list 공시가 패스스루(마진 미적용).
- API: POST /quotes/[id]/select (채택 토글, 형제 해제, audit).
- UI: PriceTableTab ExpandedRow(채택 버튼·배지·참고선) + 요약행 배지, catalog 필터=sell_price_krw.
