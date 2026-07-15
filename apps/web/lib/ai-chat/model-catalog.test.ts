import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeModelCatalogEntry, inferModelMeta, isChatModel, inferModelUseCase, CURATED_MODELS } from './model-catalog.ts'

test('용도안내: 티어별 친절 설명', () => {
  assert.match(inferModelUseCase('gemini', 'gemini-2.5-pro', { vision: true, longContext: true, reasoning: true }), /추론|분석|코딩/)
  assert.match(inferModelUseCase('gemini', 'gemini-2.0-flash-lite', { vision: true, longContext: true, reasoning: false }), /빠르고 저렴|간단/)
  assert.match(inferModelUseCase('gemini', 'gemini-2.0-flash', { vision: true, longContext: true, reasoning: false }), /빠른 범용|대화/)
})

test('필터: 이미지 생성 모델(-image·banana)은 채팅목록 제외', () => {
  assert.equal(isChatModel('gemini', 'gemini-3-pro-image'), false)
  assert.equal(isChatModel('gemini', 'gemini-3.1-flash-image-preview'), false)
  assert.equal(isChatModel('gemini', 'nano-banana-pro-preview'), false)
  assert.equal(isChatModel('gemini', 'gemini-2.5-flash'), true)
})

test('추론: 큐레이션에 없는 라이브 Gemini 모델도 능력(멀티모달)·출시일이 채워진다', () => {
  const m = inferModelMeta('gemini', 'gemini-2.5-flash')
  assert.equal(m.capabilities.vision, true)      // 멀티모달 여부 표시됨
  assert.equal(m.capabilities.longContext, true)
  assert.equal(m.releasedAt, '2025-03-25')
  assert.equal(m.label, 'Gemini 2.5 Flash')
  // pro는 추론형
  assert.equal(inferModelMeta('gemini', 'gemini-2.5-pro').capabilities.reasoning, true)
})

test('추론: merge가 큐레이션 없는 모델에 추론값을 채워 빈칸 방지', () => {
  const e = mergeModelCatalogEntry('gemini', 'gemini-2.0-flash-001', null)
  assert.equal(e.capabilities.vision, true)
  assert.equal(e.releasedAt, '2025-02-05')
  assert.notEqual(e.label, 'gemini-2.0-flash-001') // prettify됨
})

test('isChatModel: tts·embedding·imagen 제외, 일반 채팅모델 통과', () => {
  assert.equal(isChatModel('gemini', 'gemini-2.5-flash-preview-tts'), false)
  assert.equal(isChatModel('gemini', 'text-embedding-004'), false)
  assert.equal(isChatModel('gemini', 'imagen-3.0'), false)
  assert.equal(isChatModel('gemini', 'gemini-2.5-flash'), true)
})

test('추론: 큐레이션이 있으면 큐레이션이 우선(정확값)', () => {
  const e = mergeModelCatalogEntry('gemini', 'gemini-2.0-flash', null)
  assert.equal(e.label, 'Gemini 2.0 Flash')
  assert.equal(e.releasedAt, '2025-02-05')  // 큐레이션 값
})

test('큐레이션 맵에 있는 모델: 기존 행 없으면 큐레이션 값으로 채움', () => {
  const entry = mergeModelCatalogEntry('claude', 'claude-opus-4-8', null)
  assert.equal(entry.label, 'Claude Opus 4.8')
  assert.equal(entry.contextLength, 200000)
  assert.equal(entry.capabilities.reasoning, true)
  assert.equal(entry.releasedAt, '2026-05-01')
  assert.equal(entry.isActive, true)
})

test('큐레이션 맵에 없는 모델: label prettify(빈칸 방지)·이름에 신호 없으면 능력 false, released null', () => {
  const entry = mergeModelCatalogEntry('openai', 'gpt-5-unknown', null)
  assert.equal(entry.label, 'Gpt 5 Unknown')                  // prettify로 빈칸 방지(raw modelId 아님)
  assert.equal(entry.contextLength, 128000)                    // openai 기본 컨텍스트 추론
  assert.deepEqual(entry.capabilities, { vision: false, longContext: false, reasoning: false }) // 이름에 멀티모달/추론 신호 없음
  assert.equal(entry.releasedAt, null)                         // 출시일 단서 없음
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
