# 01 Architecture

## 데이터 모델 (변경 없음 — 기존 구조로 충분)
- gpu_products: (model_name, memory, gpu_count, tier, ...) UNIQUE(model_name,memory,gpu_count,vcpu,tier).
- "모델 유니크 + 세부데이터 구분" = model_name을 **캐노니컬로 통일**하면 기존 스키마가 곧 요구사항.
- 신규 parent 테이블 불필요(YAGNI). 세부데이터=memory·gpu_count 하위행(허용).

## A. 캐노니컬 SSOT — lib/gpu/canonical-model.ts
- `canonicalizeModel(raw): { canonical: string, confident: boolean }`.
- 결정론 정규화: trim/공백압축/대소문자 표준화(표시형 유지하되 비교는 정규화). 예 "RTX PRO 6000"→"RTX Pro 6000".
- 보수적 alias 사전(확실한 동의어만): 예 'A6000'↔'RTX A6000', 'Quadro RTX 6000' 유지. **다른 시리즈/숫자/세대(Ada/Pro/4000/5000)는 절대 미병합.**
- 애매하면 confident:false → 원본 유지(오병합 0). AI 의존 없음(결정론) — 자동·무화면.

## B. 확정 하드-dedup — confirm-review-item.ts
- 매칭 전 canonicalizeModel 적용 → modelName=canonical.
- 후보 조회를 (canonical model 정규화일치, memory, gpu_count)로 → 있으면 그 product 사용(견적 supersede=최신화), 없으면 1행 생성.
- ensureStandardConfigs 호출 제거/차단(유령 ×N 생성 금지) — B2.

## C. 기존 정리 — 마이그레이션 129 (백업+소프트삭제)
- STEP1: `CREATE TABLE gpu_products_dedup_backup_20260622 AS SELECT * FROM gpu_products;` (롤백 원천).
- STEP2: 유령 사다리 소프트삭제 — `UPDATE gpu_products SET deleted_at=now() WHERE deleted_at IS NULL AND pricing_mode='quote' AND gpu_count>1 AND gcube_last_status IS NULL AND id NOT IN (SELECT product_id FROM supply_quotes WHERE product_id IS NOT NULL);`
  - = 219 유령행만. 시드(gcube)·견적행·단일카드 보존. deleted_at이라 되돌리기 가능.
- STEP3(있으면): 동일 (canonical,memory,gpu_count) 진짜 중복행 병합(견적 이관 후 소프트삭제). 측정상 거의 0.
- 가격 회귀 0: confirmed 견적행은 손대지 않음.

## 흐름 (자동·무화면)
```
견적/카탈로그 입력 → 추출 → 검토 → 확정(confirm-review-item)
  → canonicalizeModel(원본명) → (canonical,memory,gpu_count) 매칭
     → 있으면 견적 supersede(최신화)  /  없으면 1행 생성
  → 유령 사다리 생성 안 함
가격표(board) → pricing.ts → 실제 존재 구성만(유령 제거됨) → 중복0·정상가
```

## SSOT 재사용
- 정규화: 기존 confirm 매칭의 norm/distinctiveTokens 로직을 canonical-model로 흡수·재사용.
- pricing.ts 계산식 불변(전파는 유령 제거로 자연 정상화).
