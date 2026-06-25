# GPU 추출 반복실패 — 냉정한 근본원인 진단 & 설계 (분석 전용, 구현 금지)

작업: USD 소수점 표기 / 공급사 추출 누락 / "AI가 판단 안 하고 프롬프트만 땜질" 비판에 대한 코드 증거 기반 진단
일자: 2026-06-25 · 기준 버전: v0.7.274 · 상태: **보고서 (구현 안 함)**

---

## 결론 한 줄
세 증상은 별개 버그가 아니라 **하나의 구조적 병**의 세 발현이다: **"추출 로직이 SSOT로 강제되지 않고 경로마다 갈라져 있고(공급사·USD), 진짜 '판단/자기검증' 엔진(USAI)은 만들어 놓고 꺼둔 채(arch) 실서비스는 단일패스 전사+다운스트림 정규화 땜질로 버티고 있다."** → 사용자 지적이 맞다.

---

## 근본원인 3건 (코드 증거)

### RC-1. 공급사 누락 = xlsx(USAI) 경로에 공급사 필드가 아예 없음 + 2D 레이아웃 미모델링
- xlsx는 USAI 경로(`app/api/pricing/gpu/market/catalog/route.ts:172`)를 탄다.
- USAI 스키마(`lib/gpu/schema-contract.ts:6-15`)·프롬프트(mig `122/123`)·레코드타입(`usai-orchestrate.ts:100`, `intake-reconcile.ts`, `intake-verify.ts`)에 **supplier 명 필드가 전무**. discover는 `source_type_hint`(분류 라벨)만 뽑고 **공급사 "이름"을 담는 칸이 없음**.
- 병합 블록헤더(예: `B90="konst tech"` 병합 B90:B96)가 price_table bbox 밖이면 `usai-orchestrate.ts:96 subGrid(bbox)`로 **추출 입력에서 물리적으로 제외**됨.
- 우측 담당자 명부(고객사명=공급사)는 프롬프트(`123:9`)가 **"공급사로 쓰지 말라"고 명시 배제**.
- 최종 `catalog/route.ts:115`에서 **`supplier_hint: null` 하드코딩**.
- 그래서 확정 단계 `confirm-review-item.ts:209` "공급사를 특정할 수 없어 확정 불가"로 막힘.
- 대조: 이미지/PDF 경로는 `review/commit/route.ts:54`에서 supplier를 살림 → **경로 간 스키마 불일치가 진짜 원인.**

### RC-2. USD 소수점 = 포맷 정책이 SSOT로 강제되지 않음
- SSOT `lib/gpu/format-price.ts:23 fmtUSD`는 **2자리 고정·round** → "최대 3자리·올림" 표현 불가.
- `0.81018518...` 같은 원본 노출은 **fmtUSD를 우회하는 raw `${}` 5곳**: `SuppliersTab.tsx:209-210`, `HistoryTab.tsx:58/60/62/63/86`, `QuoteRegisterPreview.tsx:26`, `MarketPriceEditModal.tsx:190`.
- 추가로 **로컬 중복 포맷터 2개**(`catalog/page.tsx:175`, `IntakeGateSummary.tsx:30`)가 우회 → "한 곳만 고쳐 누락" 사고 구조.

### RC-3. 아키텍처 = "판단형 엔진"을 만들고 꺼둠
- USAI(블록발견+자기일관성검증 `intake-verify.ts:35 flagInconsistentGroups`+사람확정)는 **flag `GPU_USAI_INGEST` 기본 OFF**, 호출처 단 1곳(`catalog/route.ts:172`).
- 실서비스 경로는 `review/stream/route.ts` — **transcription-first(`transcription.ts:25`에서 일부러 "매핑·해석·정규화 금지")** + 단일패스 추출 + **행수 카운트만(`reconcile.ts:1`)**. 값 교차검증·레이아웃 추론 없음.
- 자기검증 로직(`intake-verify.ts`)은 **프로덕션에서 도달 불가**(`grep verifyItems` in api → 0건).
- 최근 ~25 커밋 중 구조변경 ≈4 vs **정규화/dedup/모델명 땜질 ≈12+** ("박멸·근본차단·재발방지·둔갑·오염" 반복) → 사용자가 느낀 "프롬프트만 손봄"의 실측 지문.

---

## 설계 방향 (구현 아님 — 승인 시 실행)

**Tier A. 즉효 (증상 해소, 저위험)**
- A1. USD 포맷 SSOT 단일화: `fmtUSD`를 `ceil(v*1000)/1000` + `max 3 dp`로. 우회 7곳 전부 `fmtUSD` 경유. 테스트 재작성. ⚠️ 비용표시에 ceil은 "원가가 더 비싸 보임"이라 표시 전용으로만(계산은 raw 유지 — 현재 그러함).
- A2. 공급사 즉시 출혈 차단: `catalog/route.ts:115` `supplier_hint: null` 하드코딩 제거 → discover 블록의 병합헤더 텍스트를 supplier 후보로 전달. (최소 패치)

**Tier B. 구조 정합 (반복 재발 차단)**
- B1. USAI 스키마/프롬프트/레코드에 **supplier 1급 필드 신설** + "병합 블록헤더가 그 아래 가격행의 공급사다" 레이아웃 규칙 명시. bbox에 블록헤더 포함.
- B2. 담당자 명부를 **배제가 아니라 fallback 매칭원**으로(공급사명 교차참조).
- B3. 추출 경로 SSOT화: xlsx/이미지/PDF가 같은 supplier 계약을 공유.

**Tier C. 본질 (프롬프트 땜질 탈출)**
- C1. `intake-verify.ts` 자기일관성 검증을 **프로덕션 필수 단계로 승격**(USAI 하드닝 또는 stream 경로 이식).
- C2. **2차 AI 자기비평 패스**: 추출 결과를 카탈로그/스펙 대비 스스로 검증 후 emit. (단일패스→검증루프)

---

## 완료 판단 기준 (분석 산출물)
- [x] 실제 xlsx 구조 해부(병합 블록헤더 13개 + 담당자명부 확인)
- [x] 3 근본원인 file:line 증거 특정
- [x] 경로 분기(USAI vs stream vs image) 차이 규명
- [x] Tier A/B/C 설계 제시
- [ ] (보류) 구현 — 사용자 명시 "절대구현하지마"
