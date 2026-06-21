# 기획: "전파"를 일급 공급가로 통합 (분석+설계 — 미구현)

> 사용자 논점: "전파라는 건 없다. 시스템이 다른 공급가에서 계산한 또 하나의 공급가일 뿐이다. 계산값이라도 공급가이니 공급가 지정 같은 동일 프로세스를 당연히 지원해야 한다."
> 본 문서는 **분석+기획만** — 구현은 사용자 지시로 보류.

## 1. 결론 (요약)
사용자 논점은 **타당**하다. 그리고 핵심 사실: **전파값은 이미 가격결정 기준(cost_basis→추천판매가)으로 100% 쓰이고 있다.** 막힌 건 오직 "공급가 지정" 버튼과 정직한 라벨뿐이다. 즉 "전파"는 별도 등급이 아니라 **출처(실견적/지정/공시) × 도출방식(직접/전파)** 중 "도출방식" 한 축일 뿐인데, 현 UI가 이를 'auto'와 섞어 2등급("전파 추정")으로 표기한다.

## 2. 현황 사실관계 (코드 근거)
- 전파 계산: `lib/gpu/pricing.ts:250-288`(bestPerGpuByModel = 모델 per-GPU 최저) → `337-361`(파생구성 effective = per-GPU×장수, is_propagated=true).
- basis 타입(`pricing.ts:79`)에 'propagated' **없음** — 전파는 basis='auto' + is_propagated=true의 비대칭 구조. ('propagated'는 cockpit/route.ts:400 로컬 필드로만 존재)
- 전파값 사용: `pricing.ts:416`→`cockpit/route.ts:416 cost_basis_krw`→`421 candidate_price`→`cockpit-to-unified.ts:85 supply_cost_krw`→추천판매가. **이미 가격기준으로 쓰임.**
- 지정 동작: `quotes/[id]/select` API는 **실존 supply_quotes 행(quote_id)의 is_selected 플래그**를 토글. 행 없으면 지정 불가.
- 전파 추정 행: `DetailPanel.tsx:254-263` — costQuotes.length===0일 때 UnifiedRow 파생필드로 합성한 **가상 행**(quote_id 없음) → 지정 버튼 조건(`q.unit_price_usd && q.suppliers`, :222) 미충족 → 버튼 없음. [수정] 누르면 "직접 수정 불가" 안내만(:274).
- 파생구성은 자체 gpu_products 행이 있어 **직접 견적 등록은 가능**(등록하면 전파 추정 행이 사라지고 정상 지정 버튼 노출). 전파 추정은 "해당 구성에 confirmed cost 견적이 0건"일 때만 표시.

## 3. 사용자 논점 판정
- ✅ 타당: 전파값은 공급가로서 완결적 역할(가격결정에 이미 사용). "지정만 불가"는 그 역할과 모순된 2등급 처우.
- ⚠️ 단, 현 제약은 "개념적 의도"가 아니라 **구현 선택의 부산물**(지정=quote 행 플래그라서 가상 행은 대상 없음).
- 개념 결함 2가지: (a) basis에 'propagated' 부재 → 출처/도출 비대칭, (b) 전파행 [수정] 버튼이 동작 안 함(UX 모순).

## 4. 설계 기획 (권장안)

### 핵심 재정의: 공급가 = 출처(source) × 도출(derivation)
| 축 | 값 |
|---|---|
| 출처(source) | 실견적 / **지정** / 공시(gcube) |
| 도출(derivation) | 직접(이 구성 자체 견적) / **전파**(원본 per-GPU×장수) |

표시 = "지정공급가(전파)", "실견적(전파)", "최저가(전파)" — "전파 추정"이라는 모호어 폐기.

### 권장: [B-경량] 지정의 전파 상속 + 정직 라벨 (새 스키마 최소)
1. **전파 시 원본 quote의 basis/source를 파생에 전달**: 파생구성 effective가 per-GPU 원본에서 왔으면, 그 원본 quote가 `is_selected`면 파생 표시도 "지정공급가(전파)"가 되도록 `pricing.ts`에서 propagation source의 basis를 함께 실어 보냄. → **×1을 지정하면 ×2/4/8이 자동으로 "지정 기준 전파"로 표기**(사용자 직관과 일치: "동일 프로세스는 당연").
2. **basis 타입에 'propagated' 추가** + is_propagated와 정합. 표시 SSOT(`basisSourceLabel`)가 "(전파)" 접미 표기.
3. **전파행 액션 정직화**: 가상 전파행의 [수정] 제거 또는 의미있는 2버튼으로 — `[원본 공급가 지정하기]`(×1 행으로 이동/하이라이트) + `[이 구성 실견적 등록]`(이미 존재). "이 값은 ×1 지정공급가 ₩2,971에서 전파됨" 근거 한 줄 표시.

→ 장점: DB 스키마 무변경(또는 basis enum 주석만), 기존 is_selected 메커니즘 유지, 사용자 멘탈모델 정합. 단점: "파생구성만 다른 공급가" 케이스는 직접 견적 등록으로 처리(이미 가능).

### 대안 (참고 — DC-ANA 도출)
- **[A] 전파 가상견적 자동생성 후 지정**: 파생구성에 `source_format='propagated'` supply_quotes 자동 INSERT → 기존 지정 API 재사용. 단점: 가짜 견적 행이 supply_quotes 오염, 원본 수정 시 동기화 부담, source_format CHECK 제약 마이그레이션 필요.
- **[C] product 단위 cost_override 컬럼**: gpu_products에 cost_override_* 추가. 단점: 공급가 데이터가 quotes/products 2곳 분산, 감사·유효성 별도 구현.

## 5. 영향 범위 (구현 시 — 목록만)
- `lib/gpu/pricing.ts`(basis enum + 전파 source 전달), `cockpit/route.ts`(costSuppliers 전파행 basis), `cockpit-to-unified.ts`(basis 매핑), `DetailPanel.tsx`(전파행 라벨·액션), `unified-row.ts`(라벨 SSOT), `basisSourceLabel`(전파 접미).
- 테스트: pricing.test.ts에 "지정→파생 전파 상속" 회귀 추가.

## 6. 다음 단계 (사용자 결정 대기 — 구현은 미착수)
권장 = **[B-경량]**. 승인 시 별도 작업으로 구현·검증(Playwright 실화면) 진행.
