# FAST PATH Summary — GPU 장수 표기 hover 시 총용량 툴팁

작업: "40GB × 2"처럼 카드당×장수로 표시되는 곳에 마우스 오버(title) 시 "총 80GB (40GB × 2)" 총용량을 보여준다.

대상(표시 SSOT + 전 렌더 경로 — 신 정책 준수):
- `lib/gpu/card-memory.ts` — `memoryTitle(memory, gpu_count)` 추가(장수>1·정수분할만 "총 N (perCard × count)", 그 외 빈문자열) + 테스트
- 실제 렌더 보드: `UnifiedTable.tsx`(행 라벨), `DetailPanel.tsx`(요약·메모리KV), `BulkReflectPanel.tsx`
- 공존(롤백) 뷰: `PriceTableTab.tsx`(칩2), `PriceCockpitTab.tsx`, `MarketTab.tsx`(행·칩·매핑목록), `catalog/page.tsx`(GpuChip)

이유: 축약 표기(카드당×장수)의 친절함 보강 — 총 VRAM이 hover로 즉시 확인되게.
방식: 각 표시 span에 `title={memoryTitle(...) || undefined}`. 빈문자열이면 title 미부여(장수1/총합표시는 툴팁 불필요).
예외: `<option>`(MarketTab 1027)은 hover title 미지원이라 제외.

영향: 표시(툴팁)만 추가. 계산·정렬·데이터 무변경.
검증: tsc 0 · 단위 6 pass · design:check 통과.
