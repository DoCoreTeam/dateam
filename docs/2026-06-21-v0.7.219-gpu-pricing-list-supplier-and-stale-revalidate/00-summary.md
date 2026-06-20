# Summary — v0.7.219

사용자 Playwright 재검 중 발견된 GPU 가격 화면 결함 2건 수정.

## 결함 1 — 가격표 리스트가 지정 공급사가 아닌 최저가 공급사명을 표시
- **증상**: A100 40GB에 NHN/ Voltage를 지정해도 가격표 리스트 행 라벨은 항상 "Equinix Metal"(최저가·만료·미지정).
- **원인**: `lib/gpu/cockpit-to-unified.ts` — UnifiedTable의 라벨/검색/정렬이 쓰는 `supplier_name`을 `cost_suppliers[0]`(최저가)로 매핑. 가격기준 공급사(effective/지정)는 `cost_supplier_name`에만 반영.
- **수정**: `supplier_name: p.effective_supplier ?? supplierName` (지정/실효 우선, 폴백 최저가).
- **검증(live)**: 지정 NHN→"NHN Cloud", 지정 Voltage→"Voltage Park"로 리스트 라벨 변경 확인.

## 결함 2 — 지정 변경이 리로드/타클라이언트 견적표 ✓배지에 반영 안 됨(영구 stale)
- **증상**: 다른 곳/리로드에서 지정이 바뀌어도 DetailPanel 견적표 ✓ 지정 배지가 옛 공급사로 고정.
- **원인**: `SWRProvider`가 영속캐시 + `revalidateIfStale:false` + `revalidateOnFocus:false`. 변경 감지 `SyncRevalidator`의 `RESOURCE_KEY_MATCHERS`에 **GPU pricing 누락**(daily/calendar/weekly/projects/accounts/deals/contacts만), `/api/work/sync/version`도 pricing 토큰 미발행. cockpit은 refreshInterval 60s로 갱신되나 quotes는 refreshInterval 없어 영구 stale.
- **수정(국소·저위험)**: GPU pricing 활성 경로 useSWR에 `revalidateIfStale: true`(마운트 재검증) 추가 — `UnifiedTableConnected`(cockpit, inventory), `DetailPanel`(quotes, audit, market prices).
- **검증(live)**: 리로드 후 배지가 stale 잠깐 표시 → ~1.5s 재검증으로 정답 자가교정 확인.

## 수정 파일
- `apps/web/lib/gpu/cockpit-to-unified.ts` (supplier_name=effective)
- `apps/web/components/pricing/gpu/unified/UnifiedTableConnected.tsx` (cockpit/inventory revalidateIfStale)
- `apps/web/components/pricing/gpu/unified/DetailPanel.tsx` (quotes/audit/market revalidateIfStale)

## 검증
- 실DB×Playwright 다중 시나리오(NHN/Voltage 지정 토글, 중간값 H1), 두 결함 수정 모두 실화면 확인
- 테스트 데이터(is_selected)는 원본으로 정밀 복원(A100=NHN), tsc 0 · pricing/parity 22/22 · design:check 통과

## 한계/후속(범위 외)
- revalidateIfStale는 활성 통합뷰 경로에만 적용. 구뷰(PriceTableTab/PriceCockpitTab)·suppliers/review 등 다른 GPU pricing 화면은 동일 stale 가능성 잔존.
- 더 완전한 해법: `SyncRevalidator`에 `pricing` matcher + `/api/work/sync/version`에 org-scoped pricing 토큰 추가. 단 이는 sync 아키텍처 확장(저자가 org-scope 의도적 보류)이라 별도 결정 필요.
