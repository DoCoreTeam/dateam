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
