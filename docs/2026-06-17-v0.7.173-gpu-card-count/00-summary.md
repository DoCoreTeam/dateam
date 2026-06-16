# v0.7.173 — GPU 가격표 장수(카드 개수) 표기

작업: GPU 행이 총용량(80/160/320GB)만 표시 → **카드당 메모리 × 장수**("40GB × 2")로 표기. 4개 화면 일관.
대상: lib/gpu(신규 formatCardMemory SSOT 유틸+테스트), tabs/PriceTableTab.tsx·PriceCockpitTab.tsx·MarketTab.tsx, pricing/catalog/page.tsx.
이유: 데이터(gpu_products.memory 총합 + gpu_count 장수)는 있는데 라벨이 총합만 뿌려 "장수에 따른 구성"이 안 보임(사용자 지적).
근거: 시드(025_gpu_products_v2.sql) A100 80GB=40×2·160=40×4·320=40×8, H100 160=80×2 등 — perCard=parseInt(memory)/gpu_count, 전부 정수 분할.
규칙(완료조건):
- [ ] `formatCardMemory(memory, gpu_count)`: count>1 & 정수분할 → `"<perCard>GB × <count>"`, count=1 → `memory` 그대로, null/비정수 → `memory` 폴백. 순수함수+단위테스트(package.json test 등록).
- [ ] PriceTableTab(칩 882·1085), PriceCockpitTab(140), MarketTab(875·898·1027·1155), catalog GpuChip 적용. 칩 폭 안깨지게(좁으면 칩=카드당, ×N은 인접/배지).
- [ ] 1장 구성 어색한 "×1" 미표기. 역산 불가 폴백. 가격/정렬 로직 무변경.
- [ ] tsc0·design·DC-REV·단위테스트 pass.
영향: 표시만 변경(계산·데이터 무변경). format-spec.ts의 VRAM 표기는 영향 큼→이번엔 칩/행 라벨 우선, formatSpec은 선택.
