# v0.7.264 설계 — 경쟁사 시세 구조 매칭 / 깡통·중복 재발 0

## 0. 왜 같은 수정이 반복돼도 재발했나 (냉정 재진단 — 확증)
이전 수정(v0.7.240/261/263)은 전부 **모델명 층**(`canonical-model.ts`)만 고침. 그러나 매칭은 **memory로 선게이팅**되어, 모델명 매칭이 돌 후보집합이 이미 비어 있었음. 4겹 원인:

| # | 원인 | 증거 |
|---|---|---|
| ① | 매칭이 `memory` 선게이팅 → 경쟁사 memory=null → 후보 0 → 모델명 매칭 무력 → 무조건 INSERT | competitor-import.ts L45-46 |
| ② | miss 시 gpu_products에 깡통 자동생성(vcpu:12·ram:16·storage:512 하드코딩) | competitor-import.ts L52-53 |
| ③ | 메모리 드리프트(B200 180↔192, B300 262↔288). normalize는 못 합침, 모델→메모리 유도 없음 | normalize.ts + DB 실증 |
| ④ | SSOT 위반: market/refresh에 import 로직 복사본(ilike+.single(), tier=1, 캐노니컬화 0) | market/refresh/route.ts L88-162 |

→ 고친 층(모델명)과 깨지는 층(memory 게이트·복사본)이 달랐음.

## 1. governing principle — 변수 다양성 내성
입력(모델표기·메모리포맷·vCPU/RAM·장수표기·구조)은 무한 다양. 특정 케이스 패치 금지. **확실히 식별되면 재사용, 애매하면 추측 말고 보류.**

## 2. 매칭 규칙 (SSOT — 단일 함수)
```
resolveProductId({ modelName, gpuCount, memory? }):
  key = coreModelKey(modelName); cnt = parseGpuCount(...)
  cands = gpu_products where coreModelKey(model_name)==key AND gpu_count==cnt AND deleted_at IS NULL
  1) memory && cands.memory==normalizeMemory(memory) → 그 변형
  2) cands.length == 1                                → 그 변형 (드리프트/결측 흡수)
  3) cands.length > 1 && memory 특정 불가             → HOLD: ambiguous_variant
  4) cands.length == 0 && 모델 존재(타 장수)          → HOLD: no_variant
  5) 모델 자체 없음                                   → HOLD: no_model
```
- **memory는 매칭 키가 아니라 세부데이터.** 단 진짜 별개 SKU(같은 장수·다른 메모리, 예 RTX 3060 8/12)는 ②에서 cands>1 → HOLD로 잘못 병합 차단.
- HOLD = gpu_products INSERT 안 함. 호출부는 review_items pending 유지 또는 명확한 422 사유 반환.

## 3. 변경 대상 (전부 SSOT 경유)
1. **신규 `lib/gpu/resolve-product.ts`** — 위 규칙 단일 구현. competitor·supplier·refresh 전부 이것만 호출.
2. **competitor-import.ts** — resolveProductId 사용. miss → INSERT 금지, held 반환. vcpu/ram은 기존 변형이 비었을 때만 보강(실데이터 덮어쓰기 금지). 하드코딩 12/16/512 제거.
3. **confirm-review-item.ts** (competitor + supplier 분기) — 동일 resolver. no_model/ambiguous → 422 "모델 미등록/특정불가 — 보류" (깡통 생성 금지).
4. **market/refresh/route.ts** — 지역 복사본 삭제 → competitor-import SSOT import.
5. **일회성 마이그레이션 스크립트** — 드리프트 중복 병합(견적 보유 변형으로 매핑 재지정 → 빈 변형 소프트삭제, /tmp 백업). 대상: B200 180↔192, B300 262↔288, RTX Pro 6000 96↔48(세대 확인 후), 기타 datacenter 드리프트. **consumer 듀얼메모리(3060 8/12 등)는 별개 SKU라 보존.**

## 4. 테스트 전략 (변수 다양성 케이스)
- 다양한 모델 표기(NVIDIA HGX B200/B200/ b200 /hyphen/오타근접) → 동일 productId 또는 HOLD
- memory 결측·드리프트(180/192/없음) → 단일 변형 흡수, 신규생성 0
- 같은 장수 다중 메모리(3060 8/12) → ambiguous HOLD (잘못 병합 0)
- 모델 미등록 → no_model HOLD (깡통 0)
- 핵심 불변식 테스트: **어떤 입력에도 자동 INSERT는 명시적 1변형 정확매칭일 때만, 그 외 0**
- 회귀: 기존 supplier 견적 확정 정상 동작 유지

## 5. 완료 기준
- [ ] resolveProductId SSOT + competitor/supplier/refresh 3경로 모두 경유(복사본 0)
- [ ] miss 시 gpu_products 자동 INSERT 0건 (테스트로 강제)
- [ ] 드리프트 중복 병합 완료(백업) + consumer 듀얼메모리 보존 확인
- [ ] vcpu/ram 하드코딩 기본값 제거
- [ ] 전체 테스트 + design:check + next build + 실데이터 E2E(경쟁사 확정→올바른 변형 결합/보류) 통과
- [ ] 🟥 DC-REV APPROVED
