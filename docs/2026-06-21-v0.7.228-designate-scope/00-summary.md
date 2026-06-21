# v0.7.228 — 공급가 지정 범위 선택 (전파=일급 공급가)

## 작업
파생 구성(×1/×2/×4/×8) 어디서든 [공급가 지정]이 가능하고, 클릭 시 범위 선택 모달(① 이 모델 4개 구성 전부 ② 이 구성만)이 뜬다. 전파 행은 모태(원본 견적)를 알고 있어 그것을 지정 대상으로 삼는다 → "어느 구성이 진짜 견적인지" 4개를 눌러볼 필요 없음.

## 배경 (사용자 논점)
"전파"는 별도 등급이 아니라 시스템이 ×1 공급가에서 계산한 또 하나의 공급가일 뿐. 계산값도 공급가이므로 실견적·지정과 동일 프로세스(공급가 지정)를 지원해야 한다. 4개 구성 중 모태를 찾으려 다 눌러보는 수고 제거 → 지정 시 "전부/이것만" 모달로 선택.

## 설계 (모델단위 지정 상속 — 사용자 승인)
- 지정 = `supply_quotes.is_selected` (기존) + 새 `selection_scope`('config'|'model').
- scope='model': 그 견적의 per-GPU×장수를 모델의 모든 파생 구성이 '지정공급가(전파)'로 상속(basis='selected', is_propagated). 자체 지정(config) 우선.
- 전파 구성은 모태 견적 id(`propagation_source_quote_id`)를 노출 → 파생 행 [지정]이 모태를 대상.

## 수정 파일
1. `supabase/migrations/125_supply_quote_selection_scope.sql` — selection_scope 컬럼(비파괴 ADD, default 'config').
2. `lib/gpu/pricing.ts` — selection_scope 페치, bestPerGpuByModel에 모태 quote_id, modelSelected 맵, 파생 상속 로직, propagation_source_quote_id 노출(CatalogProduct).
3. `app/api/pricing/gpu/quotes/[id]/select/route.ts` — scope 파라미터, model 범위 시 모델 전 구성 채택 해제 후 단일 지정.
4. `app/api/pricing/gpu/cockpit/route.ts` + `lib/gpu/cockpit-to-unified.ts` + `lib/gpu/unified-row.ts` — propagation_source_quote_id 전달.
5. `components/pricing/gpu/unified/DetailPanel.tsx` — 지정 범위 모달, 실견적/전파 행 [공급가 지정] 버튼(전파는 모태 대상), gpu-modal-* 표준 재사용.
6. `lib/gpu/pricing.test.ts` — 모델범위 상속 / 구성범위 비상속 회귀 2건.

## 영향 범위
- 가격결정(콕핏) 공급원가·판매가: 모델범위 지정 시 4개 구성 일관 반영.
- 기존 config 지정 동작 불변(default 'config').

## 완료조건
- [ ] tsc / 전체 단위테스트 통과(모델범위 상속·구성범위 비상속)
- [ ] next build 통과
- [ ] 마이그레이션 125 적용
- [ ] Playwright 실화면: A100 40GB Equinix "4개 전부 지정" → ×2/×4/×8 '지정 기준 전파' 표기 + cost_basis 일관
- [ ] 테스트 후 데이터 원복(is_selected/selection_scope 원상복귀)
- [ ] 🟥 DC-REV 승인
