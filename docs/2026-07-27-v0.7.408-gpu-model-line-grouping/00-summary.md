# GPU 모델 그룹핑 확장 — 에디션(Ti/Super) + 세대 라인 (v0.7.408)

작성: 2026-07-27

## 사용자 요구 (스크린샷 2장 + 대화)
1. "RTX 5070"으로 모델명 끝나고 "Ti"는 하위 변형으로 그룹핑 (RTX 5070 + RTX 5070 Ti = 한 그룹)
2. "GB200"처럼 base명으로 표시 (단일 폼팩터도 "GB200 SXM"이 아니라 "GB200")
3. 같은 제품 라인의 세대 차이도 한 그룹 — Quadro RTX 6000 → RTX A6000 → RTX 6000 Ada → RTX PRO 6000 = "RTX 6000" 라인 (탐색 쉽게)
4. 나머지 모든 모델도 동일 형식

## 근본 원인
`baseModelKey`(그룹핑 SSOT)가 **폼팩터(SXM/PCIe/NVL)만** 접고, 에디션(Ti/Super)·세대 라인은 안 접었다. 그래서 RTX 5070/5070 Ti가 별도 행, A6000/6000 Ada/PRO 6000이 별도 행.

## 구현 (SSOT 1곳 → 4개 표면 동시 반영)
`lib/gpu/canonical-model.ts`에 그룹핑 축 2개 추가:
- **에디션 접미**(`extractEdition`): 후행 " Ti"/" Super"/" Ti Super"만 분리. ⚠️ "Ada"(세대)·"L40S"(S=모델일부)는 보존.
- **세대 라인**(`rtxLineNumber`): RTX 계열(RTX/Quadro/A+4자리)만 4자리 번호로 라인 키. "RTX A6000"·"RTX 6000 Ada"·"RTX PRO 6000"·"Quadro RTX 6000" → 모두 `rtx6000`.
- `baseModelKey`/`baseModelName` = 폼팩터+에디션+라인 접기. `modelVariantLabel` = 하위 구별 라벨("SXM"·"Ti"·"Ada"·전체명).

### ⚠️ 과병합 방지 (사장님이 처음 싫어하신 그것)
숫자만으로 묶으면 A100·V100·H100(전부 100), A40·L40(전부 40)이 잘못 합쳐진다. → 라인 병합은 **RTX 계열에만** 적용, 데이터센터(A100·L40·H100·B200·GB200 등)는 `coreModelKey` 그대로. 단위 테스트로 A100≠V100≠H100, A40≠L40, L4≠T4, B200≠GB200 보장.

### 매칭/가격 무영향
그룹핑은 **표시 전용 SSOT**. 가격 매칭·중복제거(`coreModelKey`·`canonicalizeModel`·`resolveProductId`)는 **건드리지 않음** → 데이터·가격 계산 무영향.

## 적용 표면 (feedback_all_connected_surfaces)
- 가격표 `UnifiedTable` (변형 배지 = modelVariantLabel)
- 스펙관리 `SpecsTab` (variantLabel SSOT화, 단일변형도 base명, "폼팩터"→"변형" 라벨)
- 스펙 API `specs/route.ts` (groupModels가 baseModelKey로 그룹, 변형 정렬=세대 최신순)
- 판매가격표 `catalog/page.tsx` (baseModelKey/Name 자동 반영)

## 검증
- 단위: canonical-model 29건(에디션·라인·과병합안전·변형라벨 신규) + 전체 1357건 통과
- tsc / lint / design:check 통과

## 남은 것 (Part B — 별도)
"구성 1/2/4/8장 시스템 계산" — **행 생성 금지**(v0.7.240: ×N 파생 행이 +355% 오가격 사고 원인, no-op화). → **표시계층 계산**으로 같은 결과를 내야 함. 별도 단계로 진행.
