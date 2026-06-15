# 02 작업 분해

## Phase 1 — DB (DC-DEV-DB)
- T1 migration 090_catalog_intake.sql
  - `review_items` ADD COLUMN `target text not null default 'supplier' check (target in ('supplier','competitor'))`
  - channel CHECK 재정의: 기존(mail/msg/pdf/img/own/market_link) + 'catalog'
  - ai_prompts seed: `gpu.catalog-map` v1 (헤더→필드 매핑 지시, 출력 JSON 스키마)
  - 멱등(IF NOT EXISTS / DROP-ADD), RLS 영향 없음(기존 정책 유지)

## Phase 2 — 백엔드 (DC-DEV-BE)
- T2 lib/gpu/catalog-parse.ts
  - `parseCatalogBuffer(buf: ArrayBuffer, filename): { headers: string[]; rows: Record<string,unknown>[]; sample: Record<string,unknown>[] }`
  - xlsx.read(buf) 첫 시트 sheet_to_json. csv는 동일 lib. 각 셀 문자열은 sanitizeCell.
  - 행수 상한 1000(런어웨이 방지), sample=상위 8행
- T3 lib/gpu/catalog-map.ts (순수)
  - `CatalogMapping` 타입 + `validateMapping(raw): CatalogMapping | null` (필드 화이트리스트, competitor_name·model_name·price_usd 필수)
  - `applyMapping(rows, mapping): CompetitorPriceItem[]` — location split, 숫자화, spot→pricing_model, 빈행 skip
  - Date/random 미사용
- T4 app/api/pricing/gpu/market/catalog/route.ts (POST, multipart/form-data: file + is_test)
  - requireAdminApi → 파일 읽기 → parseCatalogBuffer
  - getGeminiConfig·loadSchemaDigest·loadSpecContext
  - callGeminiOnce(매핑프롬프트, jsonMode) → validateMapping; null이면 synthesize 재시도(거버넌스) → 그래도 null이면 400
  - applyMapping(전행) → dedupCompetitor → partitionValid → review_items INSERT(target=competitor, channel=catalog, is_test)
  - 응답 { mapping, count, blocked, sample(상위 5 변환결과), ai: {prompt_key, synthesized} }
- T5 review/[id] confirm 분기
  - item.target==='competitor' → ex=current_extracted → saveCompetitorPrices(admin,[{competitor_name,model_name,memory,price_usd,pricing_model}], null) → review_items confirmed + audit. 기존 supplier 분기는 그대로.

## Phase 3 — 프론트 (DC-DEV-FE)
- T6 QuoteRegisterTab
  - accept에 .xlsx,.xls 추가. 파일 선택 시 확장자가 표/시트면 "카탈로그 일괄 모드"로 분기 → /market/catalog 호출(FormData)
  - 결과: 매핑표(원본헤더→우리필드 + 단위/통화) + 상위 미리보기 + "검토대기 N건 적재됨" + 검토대기 링크
  - input-field/label/공용버튼 표준 준수
- T7 검토대기 리스트/확인 — competitor-target 항목이 리스트에 뜨고 confirm 동작(필요시 최소 렌더 보강)

## Phase 4 — 테스트 (DC-QA/SEC/REV)
- T8 catalog-parse.test.ts / catalog-map.test.ts (applyMapping 결정성, location split, 단위/숫자, 빈행) → package.json test 목록 추가
- T9 Playwright: 실 xlsx 업로드→매핑→검토대기 적재 확인→승인→market_prices 행 확인(is_test) → revert. 변형(컬럼 뒤섞기)·모호 케이스 포함
- T10 DC-SEC(업로드/인젝션/화이트리스트) · DC-REV(점수)

## Phase 5 — 마무리
- T11 GATE 1-5 + 버전 v0.7.115 (package.json×2, CLAUDE.md, AGENTS.md) + design:check + commit
