# 기획: 공급가 "선택" UX 재설계 + 상태 매트릭스 (구현 금지)

> 사용자 요구(2026-06-21): ①배지 텍스트 침범 수정 ②"지정 공급가"→"선택됨"(회사명 옆 ✓체크 제거, "선택됨" 칩만) ③버튼 "지정 해제"→"지정 취소" ④취소 시 gcube 있으면 폴백·없으면 경고("지정 공급가 없음, 다른 거 선택") ⑤전체를 **매트릭스로 표현해 구멍(미정의 케이스) 제거**. **기획만 — 절대 구현 금지.**

## 1. UI 표현 변경 (배지·라벨·버튼)

### 1-1. 배지 오버플로우 (원인·해결)
- 원인: `<td>` 안에 `SupplierCell`(inline-flex)과 배지(inline-flex)가 **묶는 컨테이너 없이** 나열, `<td>`에 폭제한·줄바꿈 규칙 없음, 배지에 `white-space:nowrap` 없음, 회사명에 ellipsis 없음 (`DetailPanel.tsx:214-218`, `globals.css:6802` `.gpu-udetail-sup`).
- 해결: 회사셀+칩을 하나의 flex 컨테이너(`display:flex; align-items:center; gap; min-width:0`)로 묶고 → 회사명 `<span>`에 `min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap`, 칩에 `flex-shrink:0; white-space:nowrap`. (CSS 전역 클래스로, 인라인 금지)

### 1-2. 라벨/칩 (SSOT `lib/gpu/terms.ts`)
- `designatedCost` "지정 공급가" → **"선택됨"** (회사명 옆 칩. ✓ 체크 제거 — 텍스트만).
- 칩은 회사명 **오른쪽**에 작은 pill(예 `gpu-chip-selected`)로, 색은 `status-colors.ts`에 `SUPPLY_STATE` 추가해 SSOT화.
- `basisSourceLabel`의 'selected' 출처 라벨도 동일어로 통일("선택된 공급가").

### 1-3. 버튼
- `undesignateCost` "지정 해제" → **"지정 취소"**.
- `designateCost` "공급가 지정" 유지(또는 "공급가 선택"으로 통일 — §4 결정).

## 2. "지정 취소" 동작 규칙 (폴백)
취소(=is_selected off) 시 결과를 **매트릭스로 결정**(아래 §3-B). 사용자 명시 규칙 직역:
- **gcube 공시가 존재** (`list_price_krw != null` 또는 모델 list 전파로 `sell_price_krw` 도출) → gcube로 폴백(basis='list'). 조용히 반영.
- **gcube 없음 + 다른 실견적도 없음** → **경고 모달**: "지정된 공급가가 없습니다. 다른 공급가를 선택하세요." (취소는 수행하되 공급원가 미설정(none) 경고, 또는 취소 보류하고 선택 유도 — §4 결정).
- (결정 필요) **다른 실견적(cost) 존재 시**: 자동최저로 갈지 vs 사용자에게 선택 요구할지 — §4-A.

## 3. 공급가 상태 매트릭스 (구멍 없는 전수 정의)

### 3-A. 표시 매트릭스 — 행 = (출처 basis × 도출), 셀 = 화면 표현
| 출처(basis) | 도출 | 회사명 옆 | 상태칸 | 약정칸 | 행 액션 | 행 강조 |
|---|---|---|---|---|---|---|
| 선택됨(selected) | 직접(own) | **선택됨** 칩 | 확정 | 견적 약정 | [지정 취소] | 강조 |
| 선택됨(selected) | 전파(model 상속) | **선택됨** 칩 | 시스템 계산 | 모태 약정 | [지정 취소](모태 대상) | 강조 |
| 자동최저(auto) | 직접 | — | 확정 | 견적 약정 | [공급가 선택] | — |
| 자동최저(auto) | 전파 | — | 시스템 계산 | 모태 약정 | [공급가 선택](모태) | — |
| 공시가(list=gcube) | 직접/전파 | — | 공시가 | — | (선택 대상 아님) | — |
| 없음(none) | — | — | — | — | [실견적 등록] | — |
| 직판(direct) | — | — | 직판 | — | — | — |

→ basis='fallback'은 만료 제거(v0.7.226)로 **도달 불가** → 매트릭스에서 제외(구멍 제거 완료).

### 3-B. 취소 폴백 매트릭스 — "지정 취소" 누른 순간 결과
| 다른 실견적(cost) | gcube/공시 | 취소 결과 | UX |
|---|---|---|---|
| 있음 | 무관 | (결정 §4-A) 자동최저 또는 선택요구 | basis=auto 또는 모달 |
| 없음 | 있음 | gcube 폴백 | basis=list, 조용히 반영 |
| 없음 | 없음 | **공급원가 없음** | 경고 모달 "지정 공급가 없음 — 다른 거 선택" |

→ 모든 (실견적유무 × gcube유무) 4조합 정의됨 = 구멍 없음.

### 3-C. 화면 "구멍" 보강 (DC-ANA 발견)
- G(list 전파, `list_price_krw=null`인데 sell 있음): 상태칸 "공시가(전파)"로 명시.
- H(none): 현행 "등록된 항목이 없습니다" → "공급가 없음 — [실견적 등록]/[공급가 선택]" 행동 유도로.

## 4. 결정 필요 (사용자)
- **§4-A**: "지정 취소" 시 **다른 실견적이 있으면** → (a)자동최저로 자동 폴백(기존 동작·스마트) vs (b)gcube/경고와 동일하게 "다른 거 선택" 요구(사용자 발언 직역, 무단 공급사 변경 방지). **CEO 권장: (b)** — 지정은 의도적 행위이므로 취소 후 무단 자동선택 대신 명시 선택 유도가 사용자 철학과 일치.
- **§4-B**: 버튼 라벨 통일 "공급가 지정"→"공급가 선택" 여부.
- **§4-C**: gcube 폴백을 "공급원가(cost) 기준"으로 쓰는 게 맞는지(gcube는 공시 판매가) — 표시만 vs 가격계산 기준.

## 5. 영향 파일 (구현 시 — 목록만)
- `lib/gpu/terms.ts`(라벨), `components/pricing/gpu/unified/DetailPanel.tsx`(배지/칩/버튼/취소 모달·행), `app/globals.css`(셀 flex·ellipsis·칩 클래스), `lib/tokens/status-colors.ts`(SUPPLY_STATE 색 SSOT), `app/api/pricing/gpu/quotes/[id]/select/route.ts`(취소 폴백 판정 응답), `lib/gpu/unified-row.ts`(필요 시 폴백판정 필드). 매트릭스 표시 로직은 `lib/gpu`의 공용 함수(SSOT)로.

## 6. 다음 단계
권장안 + §4 결정 확정 시 별도 작업으로 구현·Playwright 실검증. 구현 미착수.
