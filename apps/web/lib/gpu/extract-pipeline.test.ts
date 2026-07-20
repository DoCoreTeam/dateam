import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractCompetitorObservations, type ExtractPipelineItem } from './extract-pipeline.ts'

const SPEC_CONTEXT = '[보유 모델 카탈로그]\nH100 (VRAM 80GB, Hopper)'
const FX = { KRW: 1, USD: 1400 }

function mockCaller(responseText: string) {
  return async () => responseText
}

function observationsPayload(observations: Array<Record<string, unknown>>): string {
  return JSON.stringify({ observations })
}

function baseObs(overrides: Record<string, unknown> = {}) {
  return {
    competitor_name: 'Nebius', model: 'H100', form_factor: 'SXM', memory_gb: 80, gpu_count: 1,
    amount: 3.5, currency: 'USD', unit: 'hour', per_qty: 1, component_kind: 'usage',
    catalog_match: 'H100', match_basis: 'exact', price_tier: 'on_demand',
    provenance: 'H100 $3.5/hr',
    ...overrides,
  }
}

test('extractCompetitorObservations assembles model_name via canonical + form_factor and computes price_usd', async () => {
  const res = await extractCompetitorObservations({
    apiKey: 'k', model: 'm', sourceText: 'H100 $3.5/hr', specContext: SPEC_CONTEXT,
    provider: null, sourceUrl: null, krwPerUsd: 1400, fxMap: FX, fxDate: '2026-07-20',
    geminiCaller: mockCaller(observationsPayload([baseObs()])),
  })
  assert.equal(res.items.length, 1)
  assert.equal(res.items[0].model_name, 'H100 SXM')
  assert.equal(res.items[0].competitor_name, 'Nebius')
  assert.equal(res.items[0].price_usd, 3.5)
  assert.equal(res.items[0].price_unknown, false)
  assert.equal(res.aiItemsCount, 1)
  assert.equal(res.detSupplemented, 0)
  assert.deepEqual(res.crosscheckConflicts, [])
})

// observation-contract.validateAiObservation requires non-empty competitor_name (missing_field otherwise),
// so a *valid* AI observation always carries a name and the `o.competitor_name || provider || providerFromUrl(...)`
// fallback chain in review/stream is defense-in-depth for that field. We verify the AI-supplied name wins,
// and separately verify the provider/providerFromUrl fallback order directly via the exported helper
// (providerFromUrl is the same SSOT the pipeline falls back to).
test('extractCompetitorObservations uses the AI-supplied competitor_name when present', async () => {
  const res = await extractCompetitorObservations({
    apiKey: 'k', model: 'm', sourceText: 'H100 $3.5/hr', specContext: SPEC_CONTEXT,
    provider: 'FallbackCo', sourceUrl: 'https://example.com/pricing', krwPerUsd: 1400, fxMap: FX, fxDate: null,
    geminiCaller: mockCaller(observationsPayload([baseObs({ competitor_name: 'Nebius' })])),
  })
  assert.equal(res.items[0].competitor_name, 'Nebius')
})

test('extractCompetitorObservations attaches base_fee/storage as components on the primary model, excluded from price axis', async () => {
  const observations = [
    baseObs({ amount: 3.5 }),
    baseObs({ component_kind: 'base_fee', amount: 30000, currency: 'JPY', unit: 'month', per_qty: 1, provenance: '월額基本料金 30,000円' }),
    baseObs({ component_kind: 'storage', amount: 1000, currency: 'JPY', unit: 'per_gb', per_qty: 100, provenance: 'ストレージ 1,000円/100GB' }),
  ]
  const res = await extractCompetitorObservations({
    apiKey: 'k', model: 'm', sourceText: 'H100 usage+base+storage', specContext: SPEC_CONTEXT,
    provider: null, sourceUrl: null, krwPerUsd: 1400, fxMap: FX, fxDate: null,
    geminiCaller: mockCaller(observationsPayload(observations)),
  })
  assert.equal(res.items.length, 1)
  assert.equal(res.items[0].components?.length, 2)
  assert.equal(res.items[0].price_usd, 3.5)
})

test('deterministicItems union: AI-present adds only non-duplicate GPU-valid deterministic items', async () => {
  const det: ExtractPipelineItem[] = [
    { competitor_name: 'X', model_name: 'A100', price_usd: 2.1, original_price: 2.1, pricing_model: 'on_demand', obs: { amount: 2.1 } },
    { competitor_name: 'X', model_name: 'H100', price_usd: 3.5, original_price: 3.5, pricing_model: 'on_demand', obs: { amount: 3.5 } }, // dup of AI item (same amount)
    { competitor_name: 'X', model_name: 'NVMe Storage', price_usd: 10, original_price: 10, pricing_model: 'on_demand', obs: { amount: 10 } }, // not a GPU model -> excluded
  ]
  const res = await extractCompetitorObservations({
    apiKey: 'k', model: 'm', sourceText: 'H100 $3.5/hr A100 $2.1/hr', specContext: SPEC_CONTEXT,
    provider: null, sourceUrl: null, krwPerUsd: 1400, fxMap: FX, fxDate: null,
    geminiCaller: mockCaller(observationsPayload([baseObs()])),
    deterministicItems: det,
  })
  assert.equal(res.detSupplemented, 1)
  assert.equal(res.items.length, 2)
  assert.ok(res.items.some((it) => it.model_name === 'A100'))
})

test('deterministicItems adopted as-is when AI yields nothing but deterministic has a valid GPU model', async () => {
  const det: ExtractPipelineItem[] = [
    { competitor_name: 'X', model_name: 'A100', price_usd: 2.1, original_price: 2.1, pricing_model: 'on_demand', obs: { amount: 2.1 } },
  ]
  const res = await extractCompetitorObservations({
    apiKey: 'k', model: 'm', sourceText: 'no gpu prices here', specContext: SPEC_CONTEXT,
    provider: null, sourceUrl: null, krwPerUsd: 1400, fxMap: FX, fxDate: null,
    geminiCaller: mockCaller('not json'),
    deterministicItems: det,
  })
  assert.equal(res.aiItemsCount, 0)
  assert.equal(res.items, det)
})

test('items=[] when AI yields nothing and deterministic has no GPU-valid item (signals caller to run its own fallback)', async () => {
  const det: ExtractPipelineItem[] = [
    { competitor_name: 'X', model_name: 'Storage Plan', price_usd: 10, original_price: 10, pricing_model: 'on_demand', obs: { amount: 10 } },
  ]
  const res = await extractCompetitorObservations({
    apiKey: 'k', model: 'm', sourceText: 'no gpu prices here', specContext: SPEC_CONTEXT,
    provider: null, sourceUrl: null, krwPerUsd: 1400, fxMap: FX, fxDate: null,
    geminiCaller: mockCaller('not json'),
    deterministicItems: det,
  })
  assert.deepEqual(res.items, [])
})

test('crosscheck flags amount-matching items with conflicting model names and holds price', async () => {
  const det: ExtractPipelineItem[] = [
    { competitor_name: 'X', model_name: 'B300', price_usd: 3.5, original_price: 3.5, pricing_model: 'on_demand', obs: { amount: 3.5 } },
  ]
  const res = await extractCompetitorObservations({
    apiKey: 'k', model: 'm', sourceText: 'GB300 $3.5/hr', specContext: SPEC_CONTEXT,
    provider: null, sourceUrl: null, krwPerUsd: 1400, fxMap: FX, fxDate: null,
    geminiCaller: mockCaller(observationsPayload([baseObs({ model: 'GB300', catalog_match: null, match_basis: 'none' })])),
    deterministicItems: det,
  })
  assert.equal(res.crosscheckConflicts.length, 1)
  const aiItem = res.items.find((it) => it.source_model_name === 'GB300')
  assert.ok(aiItem)
  assert.equal(aiItem?.price_unknown, true)
  assert.equal(aiItem?.price_usd, null)
})

test('completeness gate flags amounts present in source text but missing from extracted items', async () => {
  const res = await extractCompetitorObservations({
    apiKey: 'k', model: 'm', sourceText: 'H100 $3.5/hr, storage fee ¥2,500,000/month', specContext: SPEC_CONTEXT,
    provider: null, sourceUrl: null, krwPerUsd: 1400, fxMap: FX, fxDate: null,
    geminiCaller: mockCaller(observationsPayload([baseObs()])),
  })
  assert.equal(res.completeness.complete, false)
  assert.ok(res.completeness.uncovered.includes(2500000))
})

test('AI call failure (exception) is captured as rejection, items empty when no deterministic fallback', async () => {
  const res = await extractCompetitorObservations({
    apiKey: 'k', model: 'm', sourceText: 'x', specContext: SPEC_CONTEXT,
    provider: null, sourceUrl: null, krwPerUsd: 1400, fxMap: FX, fxDate: null,
    geminiCaller: async () => { throw new Error('network down') },
  })
  assert.equal(res.items.length, 0)
  // extractAiObservations catches the throw internally and returns a rejected entry (does not re-throw).
  assert.equal(res.aiRejected.length, 1)
})

// [실화면 회귀고정 v0.7.364] 교차검증 참조는 GPU 모델 항목만.
//   사고: P4 리팩터로 교차검증 참조원이 reconstructPivot → deterministicItems로 바뀌자,
//   결정론 경로가 뱉는 비GPU 라벨("GPU利用料金（1枚あたり）")이 참조에 섞였다.
//   금액 7.2가 우연히 일치해 "AI A100 ↔ 결정론 GPU利用料金" 불일치로 판정 → A100 시간제 $2.658이
//   보류 처리되며 **정상 가격이 유실**됐다. 참조에도 looksLikeGpuModel 게이트가 필요하다.
test('교차검증 — 비GPU 라벨은 참조에서 제외(정상 가격을 지우지 않는다)', async () => {
  const fake = async () => JSON.stringify({ observations: [{
    competitor_name: 'SoftBank', model: 'A100', form_factor: 'SXM', memory_gb: 80, gpu_count: 1,
    amount: 7.2, currency: 'JPY', unit: 'minute', per_qty: 1, component_kind: 'usage',
    catalog_match: null, match_basis: 'none', price_tier: 'on_demand',
    provenance: 'NVIDIA A100 時間貸しプラン GPU利用料金 7.2円/1分',
  }] })
  const r = await extractCompetitorObservations({
    apiKey: 'k', model: 'm', sourceText: 'A100 7.2円/1分', specContext: '',
    provider: 'SoftBank', sourceUrl: null, krwPerUsd: 1484, fxMap: { JPY: 9.1327 }, fxDate: '2026-07-20',
    geminiCaller: fake,
    // 결정론 경로가 흔히 뱉는 비GPU 라벨 — 금액만 같다(7.2). 이것 때문에 가격이 지워지면 안 된다.
    deterministicItems: [{ model_name: 'GPU利用料金（1枚あたり）', price_usd: 2.658, obs: { amount: 7.2 } }],
  })
  assert.equal(r.crosscheckConflicts.length, 0, '비GPU 라벨과의 대조는 충돌로 치지 않는다')
  assert.equal(r.items.length, 1)
  assert.ok((r.items[0].price_usd as number) > 0, '정상 가격이 보존돼야 함')
})

// [실화면 회귀고정 v0.7.364-2] 교차검증 비교는 **폼팩터를 뺀 core**로.
//   사고: AI는 폼팩터를 별도 축으로 분리해 model="GB300"을 주고, 결정론은 "GB300 SXM6"를 준다.
//   문자열 그대로 비교하니 같은 모델이 "불일치"로 잡혀 verda 16건의 정상 가격이 통째로 null이 됐다.
//   교차검증은 오탐이 나면 데이터를 지우므로, 비교 기준이 느슨한 쪽이 아니라 **정확한 쪽**이어야 한다.
test('교차검증 — 폼팩터 표기 차이(GB300 ↔ GB300 SXM6)는 충돌이 아니다', async () => {
  const fake = async () => JSON.stringify({ observations: [{
    competitor_name: 'Verda', model: 'GB300', form_factor: 'SXM', memory_gb: 288, gpu_count: 1,
    amount: 8.62, currency: 'USD', unit: 'hour', per_qty: 1, component_kind: 'usage',
    catalog_match: null, match_basis: 'none', price_tier: 'on_demand',
    provenance: '1x GB300 SXM6 288GB | $8.62/h',
  }] })
  const r = await extractCompetitorObservations({
    apiKey: 'k', model: 'm', sourceText: '1x GB300 SXM6 288GB $8.62/h', specContext: '',
    provider: 'Verda', sourceUrl: null, krwPerUsd: 1484, fxMap: { USD: 1484 }, fxDate: '2026-07-20',
    geminiCaller: fake,
    deterministicItems: [{ model_name: 'GB300 SXM6', price_usd: 8.62, obs: { amount: 8.62 } }],
  })
  assert.equal(r.crosscheckConflicts.length, 0, '같은 모델의 폼팩터 표기 차이는 충돌 아님')
  assert.ok((r.items[0].price_usd as number) > 0, '정상 가격 보존')
})

test('교차검증 — 진짜 다른 모델은 여전히 충돌로 잡는다(가드 무력화 방지)', async () => {
  const fake = async () => JSON.stringify({ observations: [{
    competitor_name: 'X', model: 'H100', form_factor: 'SXM', memory_gb: 80, gpu_count: 1,
    amount: 3.25, currency: 'USD', unit: 'hour', per_qty: 1, component_kind: 'usage',
    catalog_match: null, match_basis: 'none', price_tier: 'on_demand', provenance: 'H100 SXM5 80GB $3.25/h',
  }] })
  const r = await extractCompetitorObservations({
    apiKey: 'k', model: 'm', sourceText: 'H100 $3.25/h', specContext: '',
    provider: 'X', sourceUrl: null, krwPerUsd: 1484, fxMap: { USD: 1484 }, fxDate: '2026-07-20',
    geminiCaller: fake,
    deterministicItems: [{ model_name: 'A100 SXM4', price_usd: 3.25, obs: { amount: 3.25 } }],
  })
  assert.equal(r.crosscheckConflicts.length, 1, 'H100 ↔ A100은 진짜 불일치')
})
