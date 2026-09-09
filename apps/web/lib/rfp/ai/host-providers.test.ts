import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toModels, toPolicy, rfpVendorOf, hostIdOf, modelUuid, VENDOR_ALIAS } from './host-providers.ts'

const UUID = '11111111-1111-4111-8111-111111111111'

function row(over: Record<string, unknown> = {}) {
  return {
    id: UUID, vendor_id: 'google', model_id: 'gemini-flash-latest',
    display_name: 'Gemini Flash', allowed_doc_classes: ['public', 'restricted'],
    price_input_per_1m: 100, price_output_per_1m: 300,
    supports_image_input: true, enabled: true, avg_latency_ms: 500, ...over,
  }
}

test('호스트 이름과 RFP 벤더 이름의 짝 — 안 맞으면 정책이 한 번도 안 붙는다', () => {
  assert.equal(rfpVendorOf('gemini'), 'google')
  assert.equal(rfpVendorOf('claude'), 'anthropic')
  assert.equal(rfpVendorOf('grok'), 'xai')
  assert.equal(hostIdOf('google'), 'gemini')
  assert.equal(hostIdOf('anthropic'), 'claude')
  // 짝이 없으면 그대로 쓴다
  assert.equal(rfpVendorOf('openai'), 'openai')
  assert.ok(Object.keys(VENDOR_ALIAS).length >= 5)
})

test('표의 model_id 는 uuid 가 아니라 모델 이름이다', () => {
  const p = toPolicy(row())
  assert.equal(p.modelName, 'gemini-flash-latest')
  assert.equal(p.id, UUID)
})

test('RFP 표의 모델을 쓴다 — 호스트 채팅 기본값이 폐기된 이름일 수 있다', () => {
  const models = toModels(
    [{ id: 'gemini', apiKey: 'k', model: 'chat-default-that-404s' }],
    [toPolicy(row())],
  )
  assert.equal(models.length, 1)
  assert.equal(models[0].modelName, 'gemini-flash-latest')
  // 호출부가 키를 찾을 수 있어야 한다 — 호스트 쪽 이름으로 돌려준다
  assert.equal(models[0].vendorId, 'gemini')
})

test('키가 없는 벤더의 모델은 아예 안 나온다 — 쓸 수 있다 해놓고 터지면 안 된다', () => {
  assert.deepEqual(toModels([], [toPolicy(row())]), [])
  assert.deepEqual(toModels([{ id: 'gemini', apiKey: '', model: 'm' }], [toPolicy(row())]), [])
})

test('꺼진 모델은 안 쓴다', () => {
  const models = toModels([{ id: 'gemini', apiKey: 'k', model: 'm' }], [toPolicy(row({ enabled: false }))])
  // 표에 살아 있는 줄이 없으면 호스트 기본값으로 떨어진다(공개 전용)
  assert.equal(models.length, 1)
  assert.deepEqual(models[0].allowedDocClasses, ['public'])
})

test('표에 없는 벤더는 호스트 기본 모델을 공개 전용으로만', () => {
  const models = toModels([{ id: 'groq', apiKey: 'k', model: 'llama-x' }], [toPolicy(row())])
  const groq = models.find((m) => m.vendorId === 'groq')
  assert.ok(groq)
  assert.deepEqual(groq?.allowedDocClasses, ['public'])
})

test('등급과 요금이 표에서 온다 — 안 붙으면 비용이 늘 0원으로 보인다', () => {
  const m = toModels([{ id: 'gemini', apiKey: 'k', model: 'm' }], [toPolicy(row())])[0]
  assert.deepEqual(m.allowedDocClasses, ['public', 'restricted'])
  assert.equal(m.inputKrwPerMTok, 100)
  assert.equal(m.outputKrwPerMTok, 300)
})

test('기록용 uuid — 호스트 폴백 모델은 null 이다', () => {
  const [fromTable] = toModels([{ id: 'gemini', apiKey: 'k', model: 'm' }], [toPolicy(row())])
  assert.equal(modelUuid(fromTable), UUID)
  const [fallback] = toModels([{ id: 'groq', apiKey: 'k', model: 'm' }], [])
  assert.equal(modelUuid(fallback), null)
})

test('빠른 모델이 먼저 온다', () => {
  const models = toModels(
    [{ id: 'gemini', apiKey: 'k', model: 'm' }],
    [toPolicy(row({ id: UUID, avg_latency_ms: 900 })),
     toPolicy(row({ id: '22222222-2222-4222-8222-222222222222', model_id: 'fast', avg_latency_ms: 100 }))],
  )
  assert.equal(models[0].modelName, 'fast')
})
