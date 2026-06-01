# Requirements — 통합 입력 AI 라우팅

## 핵심 요구사항
1. URL 입력 → 서버 fetch → 텍스트 추출 → AI 분석
2. AI가 입력을 competitor_pricing / supplier_quote로 분류
3. competitor: competitors·gpu_products·mapping 자동 upsert → market_prices 저장
4. supplier: 기존 review_items 플로우 유지

## 비기능
- 기존 supplier 플로우 무변경
- URL fetch 실패 시 원본 텍스트 fallback
- 경쟁사 미등록 시 자동 생성
