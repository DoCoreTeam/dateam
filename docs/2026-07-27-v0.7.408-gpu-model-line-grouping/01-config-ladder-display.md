# Part B — 구성 1/2/4/8장 표시계층 계산 (v0.7.409)

## 요구
전 모델을 1·2·4·8장 구성으로, 시스템이 가격 계산해 표시. "구조 정확 → 알고리즘이 가격 계산".

## 안전 제약 (반드시 준수)
`derive-configs.ts`(ensureStandardConfigs)는 v0.7.240에 **no-op화** — ×N 파생 **행 자동생성**이 중복·**+355% 오가격**(219 유령행, 마이그129로 정리)의 근본 원인이었음. 정책: **DB엔 실 견적/스펙 구성만, 파생 ×N은 표시계층에서만**.

## 구현 — 표시계층 순수함수 (DB 미변경)
`lib/gpu/config-ladder-expand.ts` `expandStandardLadder(rows)`:
- (model_name, memory)별로 묶어 표준 사다리 `[1,2,4,8]`(config-ladder.ts SSOT)을 보장.
- 없는 장수는 **per-card × count 선형 스케일**로 합성(synthetic=true). 이는 pricing.ts "1장당 전파"와 **동일 원리**(새 계산식 아님).
  - 스케일: supply_cost/auto/sell + 번들 스펙(vcpu/ram/storage). 마진율 불변.
  - 구성별 고유값(strategic·market·reflected·competitors)은 **실 구성에만** — 합성 rung은 null(허위 표시 금지).
- **실제 존재하는 장수 구성은 원본 그대로**(계산 안 함).

배선: `UnifiedTableConnected`가 `expandStandardLadder(mergeInventory(cockpitToUnified(...)))`. UnifiedTable 행에 합성이면 "계산" 배지.

## 검증
- 단위 `config-ladder-expand.test.ts` 5건 + 전체 1362건 통과. tsc/lint/design 통과.
- ⚠️ admin 실브라우저 E2E 미검증(세션 부재) — 실화면 가격 확인 권장.
