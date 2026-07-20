import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildObservationPrompt, extractAiObservations } from './ai-observation.ts'

const SPEC_CONTEXT = '\n\n【중요 — 클라우드 가상 모델명 → 표준 모델 매핑】\n[보유 모델 카탈로그]\nH100 (VRAM 80GB, Hopper) | A100 (VRAM 40GB, Ampere)'

test('buildObservationPrompt includes catalog context injected verbatim', () => {
  const prompt = buildObservationPrompt('some source text', SPEC_CONTEXT)
  assert.ok(prompt.includes('보유 모델 카탈로그'))
  assert.ok(prompt.includes('H100 (VRAM 80GB, Hopper)'))
})

test('buildObservationPrompt instructs "no arithmetic" (산술 금지)', () => {
  const prompt = buildObservationPrompt('src', SPEC_CONTEXT)
  assert.ok(prompt.includes('절대 산술을 하지 마세요'))
  assert.ok(prompt.includes('나누지 말고'))
})

test('buildObservationPrompt instructs "if unsure, use null + match_basis none"', () => {
  const prompt = buildObservationPrompt('src', SPEC_CONTEXT)
  assert.ok(prompt.includes('확실하지 않으면 반드시 catalog_match=null, match_basis="none"으로 보고하세요'))
})

test('buildObservationPrompt requires JSON-only output with observations key', () => {
  const prompt = buildObservationPrompt('src', SPEC_CONTEXT)
  assert.ok(prompt.includes('{"observations":[...]}'))
})

test('buildObservationPrompt embeds source text', () => {
  const prompt = buildObservationPrompt('UNIQUE_SOURCE_MARKER_123', SPEC_CONTEXT)
  assert.ok(prompt.includes('UNIQUE_SOURCE_MARKER_123'))
})

// extract-helpers.ts는 @/ alias 런타임 모듈(supabase server 등)을 연쇄 import하므로 plain node:test에서
// 해석 불가 — ai-observation.ts의 geminiCaller 주입 포인트로 목(mock) 호출기를 직접 넣어 검증한다
// (extractAiObservations의 운영 기본 경로는 여전히 extract-helpers.callGeminiOnce를 그대로 재사용한다).
function mockCaller(responseText: string): (apiKey: string, model: string, text: string, jsonMode?: boolean) => Promise<string> {
  return async () => responseText
}

function throwingCaller(message: string): (apiKey: string, model: string, text: string, jsonMode?: boolean) => Promise<string> {
  return async () => { throw new Error(message) }
}

test('extractAiObservations parses valid JSON and validates each observation', async () => {
  const validObs = {
    competitor_name: 'X', model: 'H100', form_factor: 'SXM', memory_gb: 80, gpu_count: 1,
    amount: 100, currency: 'USD', unit: 'hour', per_qty: 1, component_kind: 'usage',
    catalog_match: 'H100', match_basis: 'exact', provenance: '$100/hr',
  }
  const result = await extractAiObservations({
    apiKey: 'k', model: 'm', sourceText: 's', specContext: SPEC_CONTEXT,
    geminiCaller: mockCaller(JSON.stringify({ observations: [validObs] })),
  })
  assert.equal(result.valid.length, 1)
  assert.equal(result.rejected.length, 0)
  assert.equal(result.valid[0].model, 'H100')
})

test('extractAiObservations rejects invalid observations without throwing', async () => {
  const invalidObs = {
    competitor_name: 'X', model: 'H100', form_factor: 'SXM', memory_gb: 80, gpu_count: 1,
    amount: -1, currency: 'USD', unit: 'hour', per_qty: 1, component_kind: 'usage',
    catalog_match: 'H100', match_basis: 'exact', provenance: '$-1/hr',
  }
  const result = await extractAiObservations({
    apiKey: 'k', model: 'm', sourceText: 's', specContext: SPEC_CONTEXT,
    geminiCaller: mockCaller(JSON.stringify({ observations: [invalidObs] })),
  })
  assert.equal(result.valid.length, 0)
  assert.equal(result.rejected.length, 1)
  assert.equal(result.rejected[0].reason, 'invalid_number')
})

test('extractAiObservations returns empty result (not throw) on malformed JSON', async () => {
  const result = await extractAiObservations({
    apiKey: 'k', model: 'm', sourceText: 's', specContext: SPEC_CONTEXT,
    geminiCaller: mockCaller('not json at all'),
  })
  assert.equal(result.valid.length, 0)
  assert.equal(result.rejected.length, 1)
})

test('extractAiObservations returns empty result (not throw) on API failure', async () => {
  const result = await extractAiObservations({
    apiKey: 'k', model: 'm', sourceText: 's', specContext: SPEC_CONTEXT,
    geminiCaller: throwingCaller('gemini 500'),
  })
  assert.equal(result.valid.length, 0)
  assert.equal(result.rejected.length, 1)
})

test('extractAiObservations handles missing observations key gracefully', async () => {
  const result = await extractAiObservations({
    apiKey: 'k', model: 'm', sourceText: 's', specContext: SPEC_CONTEXT,
    geminiCaller: mockCaller(JSON.stringify({ foo: 'bar' })),
  })
  assert.equal(result.valid.length, 0)
  assert.equal(result.rejected.length, 0)
})

// [실화면 회귀고정 v0.7.358] 접두 혼동 강등 — 실 Gemini에서 두 형태로 발생했다.
//   (a) AI가 model="GB200"으로 정확히 인식하고도 catalog_match="B200"을 고름(카탈로그에 GB200 부재)
//   (b) AI가 model 필드 자체를 "B300"으로 바꿔 적음(원문 GB300) → contract의 provenance 가드가 처리
//   여기서는 (a) — 거부가 아니라 **미등록 강등**이어야 한다(가격 관측은 살리고 매칭만 보류).
test('접두 혼동(GB200→B200)은 거부가 아니라 미등록 강등 — 가격 관측은 보존', async () => {
  const fake = async () => JSON.stringify({ observations: [{
    competitor_name: 'SoftBank', model: 'GB200', form_factor: null, memory_gb: null, gpu_count: 4,
    amount: 4569000, currency: 'JPY', unit: 'month', per_qty: 1, component_kind: 'flat',
    catalog_match: 'B200', match_basis: 'exact', provenance: 'サービス GB200 β版プラン | 月額 ￥4,569,000',
  }] })
  const r = await extractAiObservations({ apiKey: 'k', model: 'm', sourceText: 's', specContext: '', geminiCaller: fake })
  assert.equal(r.valid.length, 1, '관측 자체는 살아야 함(가격 유실 금지)')
  assert.equal(r.valid[0].model, 'GB200', '원문 모델 보존')
  assert.equal(r.valid[0].catalog_match, null, '매칭은 보류')
  assert.equal(r.valid[0].match_basis, 'none')
  assert.ok(r.rejected.some((x) => x.reason === 'prefix_confusion'), '사유가 사용자에게 노출돼야 함')
})

test('카탈로그에 없는 매칭명은 미등록 강등(환각 매칭 차단)', async () => {
  const fake = async () => JSON.stringify({ observations: [{
    competitor_name: 'X', model: 'Z9000', form_factor: null, memory_gb: null, gpu_count: 1,
    amount: 1, currency: 'USD', unit: 'hour', per_qty: 1, component_kind: 'usage',
    catalog_match: 'Z9000', match_basis: 'exact', provenance: 'Z9000 $1/h',
  }] })
  const r = await extractAiObservations({ apiKey: 'k', model: 'm', sourceText: 's', specContext: '', geminiCaller: fake, catalogNames: ['H100', 'A100'] })
  assert.equal(r.valid.length, 1)
  assert.equal(r.valid[0].catalog_match, null, '카탈로그에 없으므로 매칭 보류')
  assert.ok(r.rejected.some((x) => x.reason === 'catalog_match_mismatch'))
})
