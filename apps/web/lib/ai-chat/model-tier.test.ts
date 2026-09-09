import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelTier, sortModelsForMenu, isChatModel, MODEL_TIER_ORDER, MODEL_TIER_LABEL } from './model-tier.ts'

test('가벼운 쪽 이름이 무거운 쪽 이름을 이긴다 — flash-lite 는 빠름이다', () => {
  assert.equal(modelTier({ modelId: 'gemini-2.5-flash-lite' }), 'fast')
  assert.equal(modelTier({ modelId: 'gemini-2.5-pro' }), 'reasoning')
  // pro 와 flash 가 같이 들어간 이름이 실제로 있다 — 빠른 쪽으로 읽어야 순서가 안 거짓말한다
  assert.equal(modelTier({ modelId: 'gemini-3.1-pro-flash' }), 'fast')
})

test('공급자마다 다른 관용어를 같은 칸으로 읽는다', () => {
  assert.equal(modelTier({ modelId: 'claude-opus-4-8' }), 'reasoning')
  assert.equal(modelTier({ modelId: 'claude-haiku-4-5' }), 'fast')
  assert.equal(modelTier({ modelId: 'gpt-4o-mini' }), 'fast')
})

test('이름으로 못 가르면 능력 플래그를 본다', () => {
  assert.equal(modelTier({ modelId: 'some-model-x', capabilities: { reasoning: true } }), 'reasoning')
  assert.equal(modelTier({ modelId: 'some-model-x' }), 'balanced')
})

test('라벨도 함께 본다 — 아이디가 무의미한 경우가 있다', () => {
  assert.equal(modelTier({ modelId: 'm-001', label: 'Gemini 2.5 Flash' }), 'fast')
})

test('★ 쓸 수 있는 것이 언제나 먼저다 — 못 쓰는 것이 위에 있으면 매번 지나쳐야 한다', () => {
  const got = sortModelsForMenu([
    { modelId: 'dead-pro', usable: false },
    { modelId: 'alive-flash', usable: true },
  ])
  assert.deepEqual(got.map((m) => m.modelId), ['alive-flash', 'dead-pro'])
})

test('쓸 수 있는 것들 안에서는 고성능 → 범용 → 빠름', () => {
  const got = sortModelsForMenu([
    { modelId: 'a-flash', usable: true },
    { modelId: 'b-plain', usable: true },
    { modelId: 'c-pro', usable: true },
  ])
  assert.deepEqual(got.map((m) => m.modelId), ['c-pro', 'b-plain', 'a-flash'])
})

test('같은 칸 안에서는 들어온 순서를 지킨다 (카탈로그가 최신순이다)', () => {
  const got = sortModelsForMenu([
    { modelId: 'new-pro', usable: true },
    { modelId: 'old-pro', usable: true },
  ])
  assert.deepEqual(got.map((m) => m.modelId), ['new-pro', 'old-pro'])
})

test('입력 배열을 바꾸지 않는다', () => {
  const input = [{ modelId: 'a-flash', usable: true }, { modelId: 'c-pro', usable: true }]
  sortModelsForMenu(input)
  assert.equal(input[0].modelId, 'a-flash')
})

test('칸 이름이 셋 다 있다 — 이름 없는 칸이 생기면 화면이 빈 제목을 그린다', () => {
  for (const t of MODEL_TIER_ORDER) assert.ok(MODEL_TIER_LABEL[t])
})

// ── 대화용이 아닌 모델 ──

test('★ Gemma 는 대화 후보가 아니다 — 자기 초안을 답으로 뱉는다(실측 v0.7.716)', () => {
  assert.equal(isChatModel({ modelId: 'gemma-4-26b-a4b-it' }), false)
  assert.equal(isChatModel({ modelId: 'gemini-2.5-flash' }), true)
})

test('★ 임베딩·이미지·영상·음성 모델도 대화 후보가 아니다', () => {
  for (const id of ['text-embedding-004', 'imagen-3.0', 'veo-2.0', 'gemini-2.5-tts']) {
    assert.equal(isChatModel({ modelId: id }), false, id)
  }
})

test('경계를 본다 — 이름 안에 우연히 들어간 글자로 자르지 않는다', () => {
  // `gemini` 안에 `mini` 가 들어 있다. 경계가 없으면 Gemini 전 모델이 「빠름」이 된다
  assert.equal(modelTier({ modelId: 'gemini-2.5-pro' }), 'reasoning')
  // `gemma` 로 시작하지 않는 이름은 살아 있어야 한다
  assert.equal(isChatModel({ modelId: 'my-gemmalike-model' }), true)
})
