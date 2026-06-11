# 03 Test Strategy
## 단위
- 인입 변환: market_price.price_usd → supply_quotes cost 매핑(스냅샷·gpu_count·source). fx 시점 적용.
- buildCatalog: source='market_link' cost도 effective/+마진 sell에 정상 반영(기존 cost와 동일 취급).
## 통합(API)
- 연결 PATCH: supplier_id set/clear + audit. 비admin 403.
- 인입 POST: supply_quotes cost 생성 1건 + audit('market_cost_ingested') + revalidate. 중복 인입 방지(같은 market_price 재인입 가드 or 새 행+스냅샷). 비admin 403.
- 공개 v1/suppliers·market 응답에 supplier_id/연계 필드 없음 확인(보안).
## E2E(Playwright, throwaway 경쟁사/공급사 [TEST])
- 경쟁사에 공급사 연결 → "원가 인입" 승인 → 가격결정 탭에 그 모델 원가=인입가, 판매가=+마진 형성, "연계 원가" 배지.
- 공급사 탭 "경쟁사 연계" 배지.
- 시장비교에 경쟁가↔우리가.
## 게이트
tsc0 / design:check / npm test / 콘솔 0.
## 격리
throwaway 경쟁사·공급사([TEST])로 검증, 운영 경쟁사/견적 인입 금지. 종료 후 정리(인입 supply_quotes·연결·audit 롤백).
