// GPU 가격 추출 스키마 계약서 (S1) — AI가 항상 참조하는 "매개체".
// 값은 운영 DB의 information_schema·CHECK 제약에서 실측 파생(환각 금지).
// 변경 시: scripts/gen-schema-contract.mjs 재실행으로 동기화(drift 게이트). 손수정 금지.
// 마지막 동기화: 2026-06-04 (gpu_products·market_prices·competitor_product_mapping·review_items·supply_quotes)

export const SCHEMA_CONTRACT = `【출력 스키마 계약 — 아래 규칙을 반드시 준수】
1) price_usd: GPU "1장·1시간당" USD(양수). 통화·시간 단위가 다르면 환산.
   - 통화: KRW/원/₩/P/C ÷1370, JPY ÷155, EUR ×1.09 → USD
   - 시간: 월 ÷720, 주 ÷168, 일 ÷24, 년 ÷8760 → 시간당
   - 여러 장 묶음가는 장수로 나눠 1장당. 환산 시 notes에 원본 기재.
2) memory(VRAM): "80GB","40GB","48GB","24GB"처럼 숫자+GB. 공백 없이 정규화.
3) pricing_model(경쟁사): on_demand | reserved_1y | reserved_3y | spot | committed (이 외 금지, 하이픈X 언더스코어O)
4) tier: 1 | 2 | 3 만 허용(없으면 비움).
5) model_name: 표준 모델명(H100, A100, L40S, RTX4090 등). 클라우드 가상 인스턴스명은 스펙으로 표준명에 매핑(아래 카탈로그 참조).
6) channel은 mail|msg|pdf|img|own 중 하나.`
