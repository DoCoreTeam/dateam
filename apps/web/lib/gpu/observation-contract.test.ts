import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateAiObservation, observationToKrwPerGpuHour, type AiObservation } from './observation-contract.ts'

function base(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    competitor_name: '소프트뱅크',
    model: 'H100',
    form_factor: 'SXM',
    memory_gb: 80,
    gpu_count: 1,
    amount: 2500000,
    currency: 'JPY',
    unit: 'month',
    per_qty: 1,
    component_kind: 'flat',
    catalog_match: 'H100',
    match_basis: 'exact',
    provenance: '月額2,500,000円',
    ...overrides,
  }
}

test('validateAiObservation accepts a well-formed observation', () => {
  const r = validateAiObservation(base())
  assert.equal(r.ok, true)
})

test('per_qty divides amount correctly — 1,000円/100GB → per unit 10', () => {
  const r = validateAiObservation(base({
    model: 'A100', memory_gb: 40, currency: 'JPY', amount: 1000, per_qty: 100,
    unit: 'per_gb', component_kind: 'storage', catalog_match: 'A100', match_basis: 'exact',
    provenance: '1,000円/100GB',
  }))
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.value.amount / r.value.per_qty, 10)
  }
})

test('per_qty missing defaults to 1', () => {
  const raw = base()
  delete (raw as Record<string, unknown>).per_qty
  const r = validateAiObservation(raw)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.value.per_qty, 1)
})

test('per_qty zero is rejected', () => {
  const r = validateAiObservation(base({ per_qty: 0 }))
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'invalid_number')
})

test('per_qty negative is rejected', () => {
  const r = validateAiObservation(base({ per_qty: -5 }))
  assert.equal(r.ok, false)
})

test('amount NaN is rejected', () => {
  const r = validateAiObservation(base({ amount: NaN }))
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'invalid_number')
})

test('amount negative is rejected', () => {
  const r = validateAiObservation(base({ amount: -100 }))
  assert.equal(r.ok, false)
})

test('unknown unit enum value is rejected', () => {
  const r = validateAiObservation(base({ unit: 'fortnight' }))
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'invalid_enum')
})

test('unknown form_factor enum value is rejected', () => {
  const r = validateAiObservation(base({ form_factor: 'DIP' }))
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'invalid_enum')
})

test('unknown component_kind enum value is rejected', () => {
  const r = validateAiObservation(base({ component_kind: 'discount' }))
  assert.equal(r.ok, false)
})

test('unknown match_basis enum value is rejected', () => {
  const r = validateAiObservation(base({ match_basis: 'guess' }))
  assert.equal(r.ok, false)
})

test('empty provenance is rejected', () => {
  const r = validateAiObservation(base({ provenance: '' }))
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'empty_provenance')
})

test('missing provenance is rejected', () => {
  const raw = base()
  delete (raw as Record<string, unknown>).provenance
  const r = validateAiObservation(raw)
  assert.equal(r.ok, false)
})

test('match_basis=none requires catalog_match=null', () => {
  const r = validateAiObservation(base({ match_basis: 'none', catalog_match: 'H100' }))
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'catalog_match_mismatch')
})

test('match_basis=exact requires non-null catalog_match', () => {
  const r = validateAiObservation(base({ match_basis: 'exact', catalog_match: null }))
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'catalog_match_mismatch')
})

test('match_basis=none with catalog_match=null is accepted (uncertain — held)', () => {
  const r = validateAiObservation(base({ match_basis: 'none', catalog_match: null }))
  assert.equal(r.ok, true)
})

test('memory_gb negative is rejected', () => {
  const r = validateAiObservation(base({ memory_gb: -80 }))
  assert.equal(r.ok, false)
})

test('gpu_count zero is rejected', () => {
  const r = validateAiObservation(base({ gpu_count: 0 }))
  assert.equal(r.ok, false)
})

test('gpu_count missing defaults to 1', () => {
  const raw = base()
  delete (raw as Record<string, unknown>).gpu_count
  const r = validateAiObservation(raw)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.value.gpu_count, 1)
})

test('non-object input is rejected', () => {
  const r = validateAiObservation('not an object')
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'invalid_type')
})

test('missing required string field is rejected', () => {
  const raw = base()
  delete (raw as Record<string, unknown>).competitor_name
  const r = validateAiObservation(raw)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'missing_field')
})

// ── 소프트뱅크 3성분·GB200(전각 ￥ 상황) 산술 검증 ──
// 실화면 사고: GB200 행만 전각 ￥(U+FFE5)를 써서 currency null → 조용히 탈락.
// AI 경로는 currency='JPY'로 이미 정규화해 들어오므로(AI가 전각/반각 구분 없이 인식) 산술은 그대로 성립해야 한다.
test('softbank GB200 full-width yen scenario — AI already normalized currency to JPY', () => {
  const r = validateAiObservation(base({
    model: 'GB200', memory_gb: 192, currency: 'JPY', amount: 5000000, per_qty: 1,
    unit: 'month', component_kind: 'flat', catalog_match: 'GB200', match_basis: 'exact',
    provenance: '月額５，０００，０００円', // 전각 숫자·통화 원문 근거(그대로 provenance에 보존)
  }))
  assert.equal(r.ok, true)
  if (r.ok) {
    const fx = { JPY: 9.5 }
    const krwPerGpuHour = observationToKrwPerGpuHour(r.value, fx)
    assert.ok(krwPerGpuHour !== null)
    // 5,000,000 JPY * 9.5 KRW/JPY / 720h = 65,972.22...
    assert.ok(Math.abs((krwPerGpuHour as number) - (5_000_000 * 9.5 / 720)) < 1e-6)
  }
})

test('observationToKrwPerGpuHour: softbank H100 3-component month flat, gpu_count divides', () => {
  const obs: AiObservation = {
    competitor_name: '소프트뱅크', model: 'H100', form_factor: 'SXM', memory_gb: 80,
    gpu_count: 8, amount: 2500000, currency: 'JPY', unit: 'month', per_qty: 1,
    component_kind: 'flat', catalog_match: 'H100', match_basis: 'exact', provenance: '月額2,500,000円(8基)',
  }
  const fx = { JPY: 9.5 }
  const result = observationToKrwPerGpuHour(obs, fx)
  // 2,500,000 * 9.5 / 720 / 8
  const expected = (2_500_000 * 9.5) / 720 / 8
  assert.ok(result !== null)
  assert.ok(Math.abs((result as number) - expected) < 1e-6)
})

test('observationToKrwPerGpuHour: per_qty divides before fx/time conversion', () => {
  const obs: AiObservation = {
    competitor_name: 'X', model: 'A100', form_factor: null, memory_gb: 40,
    gpu_count: 1, amount: 1000, currency: 'JPY', unit: 'month', per_qty: 100,
    component_kind: 'storage', catalog_match: 'A100', match_basis: 'exact', provenance: '1,000円/100GB/月',
  }
  const fx = { JPY: 9.5 }
  const result = observationToKrwPerGpuHour(obs, fx)
  // (1000/100) * 9.5 / 720
  const expected = (1000 / 100) * 9.5 / 720
  assert.ok(result !== null)
  assert.ok(Math.abs((result as number) - expected) < 1e-9)
})

test('observationToKrwPerGpuHour: per_gb unit returns null (not time-axis)', () => {
  const obs: AiObservation = {
    competitor_name: 'X', model: 'A100', form_factor: null, memory_gb: 40,
    gpu_count: 1, amount: 1000, currency: 'JPY', unit: 'per_gb', per_qty: 100,
    component_kind: 'storage', catalog_match: 'A100', match_basis: 'exact', provenance: '1,000円/100GB',
  }
  assert.equal(observationToKrwPerGpuHour(obs, { JPY: 9.5 }), null)
})

test('observationToKrwPerGpuHour: unsupported currency (no fx entry) returns null', () => {
  const obs: AiObservation = {
    competitor_name: 'X', model: 'A100', form_factor: null, memory_gb: 40,
    gpu_count: 1, amount: 100, currency: 'EUR', unit: 'hour', per_qty: 1,
    component_kind: 'usage', catalog_match: 'A100', match_basis: 'exact', provenance: '100 EUR/hr',
  }
  assert.equal(observationToKrwPerGpuHour(obs, { JPY: 9.5 }), null)
})

// [실 Gemini 회귀고정 v0.7.357] 접두 혼동 — 실측에서 실제로 발생한 오매핑.
//   Gemini가 verda "1x GB300 SXM6 288GB" 행을 model="B300"·memory=268(옆 행 값)로 적고
//   catalog_match="B300"(exact)까지 붙였다. 프롬프트에 "확실하지 않으면 null" 지시가 있었는데도 무시했다.
//   → 프롬프트만으로는 못 막는다. provenance(원문 근거)를 앵커로 코드가 차단해야 한다.
test('접두 혼동 — model이 원문 토큰의 접미면 거부(GB300을 B300으로 매핑 금지)', () => {
  const r = validateAiObservation({
    competitor_name: 'Verda', model: 'B300', form_factor: 'SXM', memory_gb: 268, gpu_count: 1,
    amount: 8.62, currency: 'USD', unit: 'hour', per_qty: 1, component_kind: 'usage',
    catalog_match: 'B300', match_basis: 'exact',
    provenance: '1x GB300 SXM6 288GB | 32 | 225 GB | 288 GB | $8.62/h',
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'prefix_confusion')
})

test('접두 혼동 가드 — 진짜 B300은 통과(과차단 금지)', () => {
  const r = validateAiObservation({
    competitor_name: 'Verda', model: 'B300', form_factor: 'SXM', memory_gb: 268, gpu_count: 1,
    amount: 7.5, currency: 'USD', unit: 'hour', per_qty: 1, component_kind: 'usage',
    catalog_match: 'B300', match_basis: 'exact',
    provenance: '1x B300 SXM6 268GB | 30 | 255 GB | 268 GB | $7.50/h',
  })
  assert.equal(r.ok, true)
})

test('접두 혼동 가드 — 원문에 모델 토큰이 없으면 통과(판정 불가 시 과차단 금지)', () => {
  const r = validateAiObservation({
    competitor_name: 'SoftBank', model: 'GB200', form_factor: null, memory_gb: null, gpu_count: 4,
    amount: 4569000, currency: 'JPY', unit: 'month', per_qty: 1, component_kind: 'flat',
    catalog_match: 'GB200', match_basis: 'exact',
    provenance: '月額 | ￥4,569,000',
  })
  assert.equal(r.ok, true)
})
