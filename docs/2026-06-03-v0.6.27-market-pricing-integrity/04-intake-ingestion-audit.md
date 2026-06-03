# 통합입력(인입) 정확성 점검 — 구조 이해/적재가 정확한가 (분석 전용)

> 상태: **분석 전용 — 구현 금지** · 2026-06-03 · 코드 + psql 실측

## 결론 (한 줄)
**통합입력은 "장수(구성)"를 1급 데이터로 다루지 않는다.** AI 추출에 `gpu_count` 필드가 없고, 장수는 확정(confirm) 시점에 **텍스트 휴리스틱**으로만 뽑으며(메모리 무시·최소주문 오인 위험), `unit_price_usd`의 의미(1장당 vs 총액)가 **코드 의도와 실데이터/가격표 해석이 충돌**한다. → 부정확 적재 확률 높음(사용자 우려 타당).

## 1. 인입 체인
```
통합입력(QuoteRegisterTab) → POST /api/pricing/gpu/review
   ├ AI 분류(CLASSIFY) → competitor면 market_prices 자동저장(gpu_count:1 하드코딩)
   └ supplier면 AI 추출(ai_prompts: gpu.quote-extract) → review_items(pending)
검토 대기 확정 → POST /api/pricing/gpu/review/[id]
   → parseGpuCount/toPerGpuPrice → supply_quotes 적재(product 매칭/자동생성)
```

## 2. 확정 결함

### 결함 A — `unit_price_usd` 단위 의미 충돌 (CRITICAL)
- **확정 코드 의도**(review/[id] L91): `toPerGpuPrice()` = 박스가격이면 ÷장수 → **1장당 저장** 의도.
- **실데이터**(psql, B200): `unit_price_usd` ×8 = **53.591**(=8×6.70 총액), ×1=7.0084. → 실제론 **구성 전체(총액)로 저장**됨.
- **가격표 해석**(PriceTableTab): `lowest_unit_price_usd`를 **구성 전체가격**으로 표시하고 `perGpu = price ÷ gpu_count`로 역산.
- → **세 곳의 단위 가정이 불일치.** 박스가격 견적이 들어오면 confirm은 ÷장수해 1장당으로 저장하는데, 가격표는 그걸 "총액"으로 읽어 **1/장수로 축소 표시** + perGpu 재분할로 **이중 축소**. 반대로 per-GPU 견적이 총액칸에 들어가면 ×장수 과대.
- 즉 **같은 논리적 견적이 입력 표현(박스/장당)에 따라 다르게 저장 → 메뉴 표시 어긋남.**

### 결함 B — AI 추출에 `gpu_count`/구성 필드 없음
- `gpu.quote-extract` 프롬프트 필드: model_name·memory·supplier·unit_price_usd·min_qty·term·quantity… **`gpu_count` 없음.**
- "이 견적이 1장 기준인지 8장 세트인지"를 AI가 명시하지 않음 → 구조 판단이 **confirm의 텍스트 휴리스틱에 전가**.

### 결함 C — 장수 추출이 취약 (휴리스틱 한계)
- `parseGpuCount(qtyHint)` 입력 = [model_name, original_unit, min_qty, term]. **메모리(640GB=×8 신호) 미사용.**
- `(\d)장` 패턴이 **"8장 이상"(최소주문)** 을 **gpu_count=8로 오인** → 1장 단가를 8로 나누는 오적재 위험.
- 즉 최소주문수량 ↔ 구성장수 혼동.

### 결함 D — 상품 매칭과 장수 불일치 가능
- 상품은 model+memory로 매칭(640GB→×8 상품)되는데, `gpu_count`는 별도 파싱(예: 1)으로 저장 → **상품 구성(×8)과 저장 gpu_count(1) 불일치** → 가격표 perGpu 왜곡.

### 결함 E — 경쟁사 경로 장수 무시
- 경쟁사 저장은 `gpu_count:1` 하드코딩 + per-GPU 가정. 멀티GPU 경쟁가 미처리.

## 3. 영향 (메뉴 불일치로 귀결)
- 박스/세트 견적 1건만 잘못 적재돼도 가격표·시장비교·재고·고객가가 **서로 다른 금액**을 보임(03 문서의 불일치가 입력단에서 시작).
- 1장당 전파(effective util) 계획도 **unit_price 의미가 고정돼야** 정확. 안 그러면 전파가 틀린 기준 위에서 동작.

## 4. 개선 기획 (03의 effective util과 연동)

### 4-1. 단위 의미 1개로 고정 (필수 선결)
- **표준 정의 채택**: `supply_quotes.unit_price_usd` = **그 구성(gpu_count) 전체의 시간당 가격(총액)**, `gpu_count` = 구성 장수. (기존 데이터·가격표와 일치 → 마이그레이션 최소)
- 1장당 = effective util이 `unit_price_usd / gpu_count`로 산출(SSOT). DB엔 총액만, 파생은 util.
- (대안: per-GPU로 통일 — 단 기존 데이터 재계산 필요. 아래 결정)

### 4-2. AI 추출에 구조 필드 추가
- `gpu.quote-extract` 프롬프트에 **`gpu_count`(구성 장수)** + **`price_basis`("per_gpu"|"per_set"|"box_total")** 명시 추출 추가. 메모리·"x8/640GB/8장 세트" 단서를 근거로.
- competitor 프롬프트에도 동일 적용(gpu_count 하드코딩 제거).

### 4-3. 확정 UI에서 구조 검증·보정
- 검토 대기 확정 화면에 **장수·단가기준을 표시하고 사용자가 수정** 가능하게(휴리스틱 단독 금지).
- 메모리→기본 장수 사전(예: A100 640GB→8) 제안값 + 사용자 확정.

### 4-4. min_qty vs gpu_count 분리
- `parseGpuCount`가 "이상/min/최소" 동반 수량(=min_qty)은 gpu_count로 채택하지 않도록 제외 규칙.

### 4-5. 적재 정합 가드
- 저장 전 `gpu_count`와 매칭 상품의 구성/메모리 일관성 체크 → 불일치 시 확정 차단(공급사 가드와 동일 패턴).

## 5. 진단 요약
- ❓ "통합입력이 구조 이해하고 정확히 넣나?" → **부분적·불안정.** per-card 환산 로직은 있으나 ① unit 의미 미고정(코드·데이터·가격표 충돌) ② AI가 gpu_count 미추출 ③ 장수 휴리스틱 취약(min_qty 오인·메모리 미사용) ④ 상품-장수 불일치 가능. → **단위 표준 고정 + AI 구조 필드 + 확정 UI 보정**으로 정확화 필요.

## 6. 확정 결정 (2026-06-03 승인)
- **D1. unit_price_usd 표준 = "구성(gpu_count) 전체 총액"** ✅ — 기존 데이터·가격표와 일치(마이그레이션 최소). 1장당은 effective util이 `unit_price_usd / gpu_count`로 산출(SSOT 03 문서).
- **D2. 구조 확정 = AI 추출(gpu_count·price_basis) + 확정 UI 보정** ✅ — AI가 메모리·x8·세트 단서로 명시 추출, 확정 화면에서 사용자가 최종 보정. min_qty↔gpu_count 분리 + 적재 전 정합 가드 포함.
