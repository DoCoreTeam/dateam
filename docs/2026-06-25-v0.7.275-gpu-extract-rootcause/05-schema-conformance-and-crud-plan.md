# 초정밀 고도화 — 스키마 기반 AI 구조화(conformance) + 사용자 CRUD (구현 금지)

일자: 2026-06-25 · 분석/기획 전용 · 🟦 DC-ANA×2 코드 증거

## 오너 통찰 (이 시리즈의 잃어버린 고리)
추출은 3개 책무인데 가운데가 비어 있다:
1. **분석(analyze)** — 문서에서 값 읽기 → ✅ AI가 잘함
2. **구조화(structure/conform)** — **AI가 admin 스키마/카탈로그를 보고 "이 모양이구나" 하고 자기 분석을 그 구조로 바인딩** → ❌ **빠진 고리**
3. **검수·CRUD(govern)** — 사용자가 결과 능동 편집/추가/삭제 → ❌ 검수단계에 비어 있음

지금까지 5턴의 버그(키오염·held·공급사누락)는 **2단계가 없어서** 그 일을 깨지는 결정론 정규식이 떠맡은 결과다.

## 갭 A — 스키마 기반 AI 구조화(conformance) 부재

### 확인된 사실 (코드)
- admin 스키마는 실재하고 admin-editable: **추출 프롬프트 `/admin/ai-prompts`**(`ai_prompts.gpu.quote-extract`) + **스펙 카탈로그 `/pricing/gpu?tab=specs`**(`gpu_products`/`gpu_specs`, `specs/route.ts` PATCH). 단일 캐노니컬 없이 (DB digest `058_schema_digest_fn.sql` + 정적 `schema-contract.ts` + 카탈로그 + 프롬프트)가 런타임 합성.
- 스키마는 AI에 **conformance 타깃으로 주입됨**(프롬프트 산문): `extract-helpers.ts:117` "이 구조에 정확히 맞춰 추출", `:109` "카탈로그 스펙과 대조해 표준 model_name으로 매핑".
- **그러나 하드 제약 아님**: 모든 Gemini 호출이 `responseMimeType:'application/json'`만, **`responseSchema` 미사용**(`extract-helpers.ts:134,190`). "맞춰라"고 *부탁*할 뿐 *강제* 안 함.

### 진짜 갭 — 카탈로그 바인딩이 AI 재분석이 아니라 결정론 코드
- AI가 `model_name`을 뱉은 뒤, **카탈로그 행 바인딩은 100% 결정론 코드**: `resolve-product.ts:44-61`
  - 키 빈값/카탈로그無 → `held:no_model` · 변형무 → `held:no_variant` · 모호 → `held:ambiguous_variant`
  - 매칭키 = `coreModelKey`(`canonical-model.ts:54`) — 앞서 본 `H200 141GB.`→`h200.` 깨짐 지점
- 불일치 → `confirm-review-item.ts:184` **422 model_unresolved 차단**. held 탈출은 **사람뿐**(해소모달/스펙등록).
- **즉 "이 H200 141GB.는 카탈로그의 그 H200이다"라는 AI 재분석 바인딩 패스가 없음.** 카탈로그를 추출 *맥락*으로 주긴 하나, *바인딩*은 AI로 안 돌아오고 깨지는 문자열 매칭이 단독 심판.

## 갭 B — 검수단계 사용자 CRUD 부재 (커밋 후는 완비)

### CRUD 매트릭스
| | review_items (커밋 전) | 커밋 후(quotes/market/products) |
|---|---|---|
| **C 추가** | ❌ AI 추출로만 생성. 누락 행 수기추가 불가 | ✅ ProductAddModal/POST quotes |
| **R 조회** | ✅ 필드+신뢰도+근거 | ✅ |
| **U 편집** | ❌ **거의 없음** — 직접편집은 공급사·모델매핑 2개뿐. 가격/모델/메모리/수량/기간 직접수정 불가(체크박스·AI왕복·reject만) | ✅ 편집모달 전 필드 |
| **D 삭제** | △ 단건 없음, bulk delete만 | ✅ 소프트삭제+가드 |

### 결정적 발견
- 백엔드 `confirmReviewItem`은 `{...extracted, ...overrideExtracted}`로 **어떤 필드든 override 이미 지원**(`confirm-review-item.ts:80`)인데 **UI(`ReviewTab.tsx:367`)가 공급사만 전송.** → **서버는 되는데 UI 미노출 = 거의 UI 갭.**
- 검수 경험이 사실상 **accept/reject/AI재질문 3택** — 진짜 행단위 인라인 편집·누락행 추가가 없음.

## 초정밀 고도화 설계

### 고도화 1 — **AI Conformance(구조화) 패스 신설** (가운데 책무 채움)
추출(분석)과 커밋(저장) 사이에 **schema-binding AI 단계**를 둔다:
- 입력: AI의 자유분석 결과 + **카탈로그(모델·tier·memory·enum) + admin 스키마 digest**
- 작업: "이 분석을 타깃 스키마에 conform하라 — 각 행을 카탈로그 항목에 바인딩(`product_id`), 못 맞추는 필드는 후보 Top-N+사유 제시." **결정론 코드가 held 던지기 전에 AI에게 먼저 바인딩 기회.**
- 출력: provenance 유지한 채 스키마-정합 구조 + 바인딩 confidence. `coreModelKey`는 **fast-path로 강등**(맞으면 통과, 틀리면 AI 바인딩으로). `resolve-product.ts:44-61`의 단독 심판 해제.
- Gemini `responseSchema` **하드 제약** 적용(산문 부탁 → 구조 강제).
- 효과: `H200 141GB.` 같은 변형이 깨진 키로 held되는 대신 AI가 카탈로그의 H200으로 스냅. **F1 정규식 버그의 상위 구조적 해결.**

### 고도화 2 — **검수 인라인 CRUD 완성** (govern 책무)
- **U**: review_items 각 필드 인라인 편집 → 이미 있는 `override_extracted` 백엔드에 배선(또는 `PATCH /review/[id]`). 거의 UI 작업.
- **C**: 누락 행 수기 추가(빈 review_item 생성, is_manual 태깅, confidence=user-entered).
- **D**: 단건 삭제 라우트.
- 편집=사람 직접수정 / recheck=AI 재분석 — **둘을 분리** 제공(지금은 AI왕복만).
- 편집 이력은 `review_iterations`에 source=human으로 적재(감사추적).

### 고도화 3 — **2·3단계를 자기평가 루프(04)에 결선**
- conformance 결과의 바인딩 confidence가 낮으면 → 04의 AI 심판/recheck 자동 발동 → 그래도 안되면 → 검수 CRUD로 사람 에스컬레이션(후보+사유 제시).
- 즉 **분석→AI구조화→(자기평가 루프)→사람 CRUD 검수**가 한 폐루프.

## 책무 분리 최종도
```
[1 분석]  문서→값 (AI, provenance)
   ↓
[2 구조화] admin 스키마+카탈로그 보고 AI가 바인딩·conform (신규, responseSchema 강제)   ← 빠졌던 고리
   ↓  (저신뢰 → 04 자기평가 루프 자동 재시도)
[3 검수]  사용자 인라인 CRUD(편집·추가·삭제) + accept (UI 갭 메움)
   ↓
[저장]   결정론 코드는 "심판"이 아니라 "빠른 통과로"로 강등
```

## 개선항목 (구현 시 — 승인 후)
- J1. AI Conformance 패스(카탈로그+스키마 → 바인딩, Top-N 후보, responseSchema 강제)
- J2. `resolve-product` 결정론 매칭을 fast-path로 강등(AI 바인딩 폴백)
- J3. 검수 인라인 편집 UI → 기존 `override_extracted` 배선 (+`PATCH /review/[id]`)
- J4. 누락행 수기 C + 단건 D
- J5. 편집/AI재분석 분리 + `review_iterations` human source 적재
- J6. 04 자기평가 루프와 결선(저신뢰 자동 재시도→사람 에스컬레이션)

## 제외
- 구현 전부. 본 문서는 갭분석+고도화 설계.
