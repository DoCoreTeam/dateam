# 01 — 아키텍처: 7단계 고정 파이프라인 + 불변 계약

## 불변 파이프라인 (이게 "알고리즘 셋업")
```
입력 → [1 표현] → [2 구조발견] → [3 추출] → [4 정합] → [5 검증] → [6 분류] → [7 확정]
        코드        AI            AI       코드      코드+AI    AI       사람
```
파이프라인 모양(단계 + 계약)은 **불변**. 변하는 건 각 단계 내부 또는 레지스트리 1행.

## 단계별 모듈 / 계약

### Stage 1 — 표현 `lib/gpu/intake-grid.ts` (신규, 순수)
- 입력: ArrayBuffer(xlsx/csv) → 출력: `SheetGrid[]`
- `SheetGrid = { sheet: string, cells: {addr, r, c, value}[], merges: string[], maxR, maxC }`
- **전 시트** 처리(F5), **병합 보존**(F6), sanitizeCell(수식인젝션 SSOT 재사용)
- 구조 가정 0. 좌표만 보존.

### Stage 2 — 구조발견(AI) prompt `gpu.intake-discover`
- 입력: 압축 좌표격자(anchor 압축; SheetCompressor식) → 출력 JSON(고정 스키마):
- `blocks: [{ block_id, sheet, bbox(A1:F18), role:'price_table'|'contact_directory'|'spec'|'noise', header_cells:[addr], unit_hint, currency_hint, gpu_axis_hint, source_type_hint, confidence }]`
- AI가 블록 경계·역할 판정(F1·F2·F8). 하드코딩 0.

### Stage 3 — 추출(AI) prompt `gpu.intake-extract-block`
- 입력: price_table 블록 1개의 좌표격자 → 출력 records:
- `{ model_name, model_addr, price_raw, price_addr, currency_token, unit_token, term, gpu_count, confidence }`
- **provenance(addr) 필수**(F3 근본 차단 — 값이 어느 블록·셀에서 왔는지).

### Stage 4 — 정합 `lib/gpu/intake-reconcile.ts` (신규, 코드)
- 통화/단위 정규화 = **선언적 lookup SSOT** `lib/gpu/normalize-money.ts`(신규)
  - currency: {₩,원,KRW}→KRW · {$,USD}→USD … / unit: {/hr,시간당}→hour · {/mo,월}→month / gpu_count 환산
  - 환율: 기존 매매기준율(org_content) 재사용
- **형식불변 검사만**: provenance 존재 / price>0 / 산술정합(동일모델 8장↔1장 비율≈8). **도메인 밴드 금지.**
- 출력: 기존 `CompetitorPriceItem` 호환 + `{ target, provenance, confidence }`

### Stage 5 — 검증 `lib/gpu/intake-verify.ts` (신규, 코드+AI)
- 자기일관성: 동일 model이 여러 블록에 → 단위환산 후 reconcile 일치 검사
- 신뢰도 임계(`AUTO_CONFIDENCE`)·정합위반 → `needs_human:true`
- 출력: `{ auto: Item[], needsHuman: Item[] }` (둘 다 review_items로, 후자는 플래그)

### Stage 6 — 분류(AI) — Stage 2의 source_type_hint를 블록 단서로 확정
- 블록 제목 "타켓금액"→own_target / 경쟁사명+catalog→competitor / 공급사 견적→supplier
- target enum 정합(validate.ts ENUMS 정비; channel에 'catalog' 부재 → 점검)

### Stage 7 — 확정(기존 review_items) — 무변경 재사용
- `current_extracted`(jsonb)에 provenance·block·confidence·needs_human 저장(마이그레이션 최소화)
- 사람 검토 → confirm 경로(intake-routing SSOT) 그대로

## 진입점 변경
- `app/api/pricing/gpu/market/catalog/route.ts`: parseCatalogBuffer(평면) → USAI 오케스트레이터 `lib/gpu/usai-orchestrate.ts`(신규) 호출로 전환.
- 구 catalog-parse/headers/map은 **즉시 삭제 아님** — feature flag `USAI_INGEST`(기본 OFF→검증 후 ON), 롤백 경로 유지(실제 렌더 경로 우선 정책).

## 자가생성 루프 재사용
- 추출 0건/저신뢰 → 기존 `synthesizeExtractPrompt`+`prompt-governance`(eval게이트·자동롤백) 재사용.

## 변경 seam (미래 수정 = 한 곳)
| 미래 변경 | 손대는 곳 |
|---|---|
| 새 파일형식 레이아웃 | 0 (Stage2/3 AI) |
| 새 소스종류 | Stage1 어댑터 1개 |
| 새 통화/단위 | normalize-money lookup 1행 |
| 새 저장필드 | INTAKE_FIELD_MAP 1행(기존) |
| 새 항진명제 | Stage4 검사 1개 |
