# 01 Architecture
## 데이터
- 마이그082: 전 모델 표준사다리 백필. 각 model_name에 대해 누락된 {1,2,4,8} gpu_products 행 INSERT(대표행 스펙 복제 또는 최소필드). UNIQUE(model_name,memory,gpu_count,vcpu,tier) 충돌 회피(있으면 skip). 멱등.
- A100 x8 중복: 640GB/320GB 중 견적·참조 많은 쪽 정본, 나머지 deleted_at.
## 백엔드
- cockpit/route.ts: product에 실제 cost 견적 없고 effective(전파) 있으면 cost_min/max=effective 기반, cost_suppliers에 {supplier(모델 best per_gpu 공급사), unit_price_krw=per_gpu×N, is_propagated:true} 1건. 실제 견적 있으면 기존대로.
- 전파 출처: buildCatalog의 bestPerGpuByModel(모델 1장당 최저 공급사). cockpit이 catalog product의 effective_supplier/effective_unit_price_usd + is_propagated 활용.
- 가격표 ExpandedRow: _derived 구성도 모델 per_gpu 전파 근거 데이터 제공(공급사·per_gpu·식).
## 프론트
- 콕핏 원가 셀: 전파분이면 "₩X (추정)" + 배지(var(--warning/faint)). 실제와 시각 구분. SSOT status-colors.
- PriceTableTab: _derived 행 onClick 펼침 허용, 펼침에 "1장당 전파: {공급사} $per_gpu × {N} = $effective (추정)" 섹션.
- 기준선택 옆 안내 문구 + 판매가후보 [지정] → strategic-price PATCH(기존).
## 재사용
buildCatalog/effective_supplier/ensureStandardConfigs 로직/strategic PATCH/format-price/status-colors.
