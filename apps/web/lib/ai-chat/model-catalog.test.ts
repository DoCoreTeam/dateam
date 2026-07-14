import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeModelCatalogEntry, CURATED_MODELS } from './model-catalog.ts'

test('큐레이션 맵에 있는 모델: 기존 행 없으면 큐레이션 값으로 채움', () => {
  const entry = mergeModelCatalogEntry('claude', 'claude-opus-4-8', null)
  assert.equal(entry.label, 'Claude Opus 4.8')
  assert.equal(entry.contextLength, 200000)
  assert.equal(entry.capabilities.reasoning, true)
  assert.equal(entry.releasedAt, '2026-05-01')
  assert.equal(entry.isActive, true)
})

test('큐레이션 맵에 없는 모델: modelId를 label로, 기본 능력 false, released null', () => {
  const entry = mergeModelCatalogEntry('openai', 'gpt-5-unknown', null)
  assert.equal(entry.label, 'gpt-5-unknown')
  assert.equal(entry.contextLength, null)
  assert.deepEqual(entry.capabilities, { vision: false, longContext: false, reasoning: false })
  assert.equal(entry.releasedAt, null)
})

test('기존 DB 행 값은 널로 덮어쓰지 않고 보존', () => {
  const entry = mergeModelCatalogEntry('claude', 'claude-opus-4-8', {
    label: '커스텀 라벨',
    contextLength: 999,
    releasedAt: '2020-01-01',
  })
  assert.equal(entry.label, '커스텀 라벨')
  assert.equal(entry.contextLength, 999)
  assert.equal(entry.releasedAt, '2020-01-01')
  // capabilities는 기존 행에 없었으므로 큐레이션으로 보완됨
  assert.equal(entry.capabilities.reasoning, true)
})

test('기존 DB capabilities 부분값은 유지되고 나머지만 큐레이션으로 보완', () => {
  const entry = mergeModelCatalogEntry('claude', 'claude-opus-4-8', {
    capabilities: { vision: false },
  })
  assert.equal(entry.capabilities.vision, false) // 기존값 보존(큐레이션 true를 덮어쓰지 않음)
  assert.equal(entry.capabilities.reasoning, true) // 큐레이션으로 보완
})

test('CURATED_MODELS: 3개 프로바이더 모두 최소 1개 이상 모델 보유', () => {
  assert.ok(Object.keys(CURATED_MODELS.gemini).length > 0)
  assert.ok(Object.keys(CURATED_MODELS.claude).length > 0)
  assert.ok(Object.keys(CURATED_MODELS.openai).length > 0)
})
