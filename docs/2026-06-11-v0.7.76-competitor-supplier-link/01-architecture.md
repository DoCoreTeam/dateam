# 01 Architecture
## 데이터(마이그 083)
- competitors.supplier_id uuid NULL REFERENCES suppliers(id) ON DELETE SET NULL + idx.
- supply_quotes 출처: source_format(또는 source) CHECK에 'market_link' 추가 + 추적 컬럼(source_market_price_id uuid NULL, source_competitor_id uuid NULL) IF NOT EXISTS. 인입가는 스냅샷(unit_price_usd 고정).
- gpu_audit_logs action_type 'market_cost_ingested' 추가.
## 백엔드
- PATCH /api/pricing/gpu/market/competitors/[id] (or competitors): supplier_id set/clear. admin+audit.
- POST /api/pricing/gpu/market/ingest-cost: body{ mapping_id 또는 competitor_id+product_id, market_price_id }. 해당 market_price.price_usd를 supply_quotes(product_id, supplier_id=연결공급사, price_type='cost', unit_price_usd=스냅샷, gpu_count, status='confirmed', source='market_link', source_market_price_id, source_competitor_id) INSERT. requireAdminApi + recordGpuAudit('market_cost_ingested', detail{market_price_id,price_usd,competitor,fx}) + revalidateGpu. 자동 트리거 없음(명시 호출).
- 인입 원가는 buildCatalog가 기존 cost로 인식 → effective→+마진 sell 자동(SSOT 불변).
- cockpit/market/suppliers route: 연계 메타(linked_supplier_name, cost가 source='market_link'인지) 응답. 공개 v1/*는 supplier_id/연계 비노출(필드 제외 확인).
## 프론트
- MarketTab: 경쟁사 행/모달에 공급사 연결 셀렉트 + "원가로 인입" 버튼(확인 다이얼로그, 시장가·예상 판매가 미리보기). mutateGpu.
- SuppliersTab: 연계 공급사/연계원가 보유 시 "경쟁사 연계" 배지(status-colors 토큰).
- cockpit 원가/가격표 펼침: source='market_link' 견적에 "연계 원가(경쟁사 공시가 기반)" 배지(추정 배지 패턴 재사용).
## 재사용
buildCatalog/supply_quotes 파이프라인/recordGpuAudit/revalidateGpu/requireAdminApi/status-colors/format-price.
