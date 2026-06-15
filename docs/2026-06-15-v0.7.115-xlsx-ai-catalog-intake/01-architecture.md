# 01 아키텍처 — AI=매핑 두뇌 / 코드=대량 변환

## 핵심 원칙 (리서치 정석)
> AI는 헤더→스키마 매핑을 1회만 한다(비싼 지능작업). 코드가 전체 행을 결정적으로 변환한다(싸고 감사가능).
> 전행 LLM 파싱 금지(비결정·비용·감사불가·행손실). 184행이라도 매핑 1회 + 코드변환.

## 데이터 흐름
```
[xlsx/csv 업로드]
   ↓ (서버) lib/gpu/catalog-parse.ts — xlsx lib로 headers + 전체 rows + sample(상위 8행)
   ↓
[AI 헤더매핑 1회] /api/.../market/catalog
   prompt: gpu.catalog-map (ai_prompts, 거버넌스) + schemaDigest + specContext + headers + sample
   → mapping JSON { competitor_name:"location", model_name:"gpu_name", memory:"gpu_memory",
                    price_usd:"price", pricing_model:"spot", _unit:"per_hour", _currency:"USD",
                    _location_split:"vendor_region" }
   실패(파싱불가/필드부족) → synthesizeCatalogMapPrompt 자가합성 → 재시도 (= AI가 프롬프트를 바꿔가며)
   ↓
[코드 대량변환] lib/gpu/catalog-map.ts applyMapping(allRows, mapping)
   - location "vendor/region" → competitor_name=vendor
   - gpu_name → model_name (원형 유지; 표준화는 commit 시 specContext 매칭/saveCompetitorPrices가 처리)
   - price → price_usd (숫자화)
   - spot=true → pricing_model='spot', else 'on_demand'
   → CompetitorPriceItem[]  (전 184행)
   ↓
[dedup + validate] dedupCompetitor + partitionValid(validateCompetitorItem)
   ↓
[검토대기 적재] review_items INSERT
   target='competitor', channel='catalog', current_extracted=item, supplier_hint=competitor_name,
   product_hint="model memory", overall_confidence=매핑신뢰도, is_test, source_batch_id
   ↓ (사용자 승인)
[승인 commit] review/[id] POST action=confirm + target=competitor 분기
   → saveCompetitorPrices(adminClient, [item], source) → competitors + gpu_products + competitor_product_mapping + market_prices
```

## 신규/수정 파일
| 파일 | 종류 | 내용 |
|------|------|------|
| supabase/migrations/090_catalog_intake.sql | 신규 | review_items.target 컬럼 + channel 'catalog' + ai_prompts gpu.catalog-map seed |
| lib/gpu/catalog-parse.ts | 신규 | xlsx/csv → {headers, rows, sample}. sanitizeCell 재사용 |
| lib/gpu/catalog-map.ts | 신규 | validateMapping + applyMapping(순수, 단위테스트) |
| app/api/pricing/gpu/market/catalog/route.ts | 신규 | 파싱→AI매핑→대량변환→dedup/validate→review_items |
| app/api/pricing/gpu/review/[id]/route.ts | 수정 | confirm에 target=competitor 분기(saveCompetitorPrices) |
| (member)/pricing/gpu/tabs/QuoteRegisterTab.tsx | 수정 | .xlsx accept + 카탈로그 업로드 모드 + 매핑/미리보기 |
| lib/gpu/catalog-*.test.ts | 신규 | 단위테스트 (package.json test 목록 추가) |

## 재사용(SSOT) — 신규작성 금지
extract-helpers(getGeminiConfig·loadSchemaDigest·loadSpecContext·callGeminiOnce·synthesizeExtractPrompt 패턴),
dedup(dedupCompetitor), validate(validateCompetitorItem·partitionValid), normalize, tier-dict(inferTier),
competitor-import(saveCompetitorPrices), review_items 게이트, prompt-governance(autoActivatePrompt).

## 결정 포인트
- 경쟁사도 검토대기 경유: 기존 market/import 직접저장과 달리 게이트 강제(가격오염 방지 원칙).
  → review_items에 target 추가가 최소수정. confirm 라우트에 분기 1개.
- 모델 표준화는 commit 시점에 saveCompetitorPrices(ilike 매칭) + 기존 specContext 안내로. MVP는 원형 모델명 보존.
