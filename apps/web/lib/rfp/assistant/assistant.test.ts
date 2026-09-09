/**
 * 어시스턴트 가드 (설계서 3.9)
 *
 * 여기서 잠그는 것 셋
 * - 자유 형식 SQL 을 안 만들고 화이트리스트 필터만 쓰는가
 * - 없는 번호를 인용한 태그를 지우는가
 * - 등급이 섞이면 벤더를 바꾸거나 청크를 빼는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  validatePlan, ALLOWED_COLUMNS, ALLOWED_OPS, buildPlanInstruction,
  MAX_LIMIT, DEFAULT_LIMIT,
} from './intent.ts'
import { buildContext, renderContext, DEFAULT_MAX_CHUNKS, type ContextChunk } from './retrieve.ts'
import { checkCitations, buildAnswer, buildAnswerInstruction, AI_NOTICE } from './answer.ts'
import type { AiModel } from '../ai/models.ts'
import type { DocClass } from '../domain/doc-class.ts'

function 모델(over: Partial<AiModel> = {}): AiModel {
  return {
    id: 'm1', vendorId: 'v1', modelName: 'gemini-2.5-pro', displayName: 'G',
    allowedDocClasses: ['public'], internal: false,
    retention: { noTraining: true, retentionDays: 0, zeroRetention: true },
    inputKrwPerMTok: 100, outputKrwPerMTok: 400, multimodal: true, enabled: true, sortOrder: 10, ...over,
  }
}

const 청크 = (key: string, docClass: DocClass, score = 0.9): ContextChunk => ({
  chunkKey: key, caseId: `case-${key}`, text: `${key} 본문`, docClass, blockIds: [`b-${key}`], score,
})

// 질의 계획

test('허용 컬럼과 연산자가 값으로 남아 있다', () => {
  assert.ok(Object.keys(ALLOWED_COLUMNS).length >= 10)
  assert.deepEqual([...ALLOWED_OPS.text], ['contains', 'eq'])
  assert.ok((ALLOWED_OPS.number as readonly string[]).includes('between'))
})

test('모르는 컬럼은 버린다', () => {
  const { plan, problems } = validatePlan({
    filters: [
      { column: 'case.budgetAmount', op: 'gte', value: 1_000_000_000 },
      { column: 'budget', op: 'gte', value: 1 },
    ],
  })
  // 「budget」을 「case.budgetAmount」로 짐작해 고치면 짐작이 틀렸을 때 다른 질문에 답을 받는다
  assert.equal(plan.filters.length, 1)
  assert.deepEqual(problems, [{ reason: 'unknown_column', detail: 'budget' }])
})

test('타입에 안 맞는 연산자를 막는다', () => {
  const { plan, problems } = validatePlan({
    filters: [{ column: 'case.title', op: 'gte', value: 'ㄱ' }],
  })
  assert.deepEqual(plan.filters, [])
  assert.equal(problems[0].reason, 'bad_operator')
})

test('타입에 안 맞는 값을 막는다', () => {
  const cases = [
    { column: 'case.budgetAmount', op: 'gte', value: '십억' },
    { column: 'case.proposalDeadline', op: 'lte', value: '언젠가' },
    { column: 'case.stage', op: 'in', value: 'reported' },
    { column: 'case.budgetAmount', op: 'between', value: [1] },
  ]
  for (const f of cases) {
    const { plan, problems } = validatePlan({ filters: [f] })
    assert.deepEqual(plan.filters, [], `${f.column} ${f.op} 를 통과시켰다`)
    assert.equal(problems[0].reason, 'bad_value')
  }
})

test('올바른 필터는 통과한다', () => {
  const { plan, problems } = validatePlan({
    filters: [
      { column: 'case.budgetAmount', op: 'between', value: [1_000_000_000, 5_000_000_000] },
      { column: 'case.stage', op: 'in', value: ['reported', 'assessed'] },
      { column: 'case.title', op: 'contains', value: '플랫폼' },
    ],
  })
  assert.equal(plan.filters.length, 3)
  assert.deepEqual(problems, [])
  assert.equal(plan.mode, 'structured')
})

test('상한을 넘는 개수를 막는다', () => {
  assert.equal(validatePlan({ limit: 9999 }).plan.limit, MAX_LIMIT)
  assert.equal(validatePlan({}).plan.limit, DEFAULT_LIMIT)
  assert.equal(validatePlan({ limit: -1 }).plan.limit, DEFAULT_LIMIT)
})

test('조건이 없으면 의미 검색으로 간다', () => {
  const { plan } = validatePlan({ semanticQuery: '보안 요건이 빡빡했던 사업' })
  assert.equal(plan.mode, 'semantic')
  assert.equal(plan.semanticQuery, '보안 요건이 빡빡했던 사업')
})

test('프롬프트가 SQL 을 쓰지 말라고 적는다', () => {
  const p = buildPlanInstruction()
  assert.match(p, /SQL 을 쓰지 않는다/)
  assert.match(p, /목록에 없는 컬럼을 쓰지 않는다/)
  // 모델이 만드는 것은 필터다. 프롬프트는 부탁이고 검사가 통제다
  assert.match(p, /case\.budgetAmount/)
})

// 등급 처리

test('등급을 감당하는 모델이 있으면 문서를 안 자른다', () => {
  const d = buildContext({
    chunks: [청크('a', 'public'), 청크('b', 'nda')],
    models: [모델({ id: 'pub' }), 모델({ id: 'int', internal: true, allowedDocClasses: ['public', 'restricted', 'nda'] })],
  })
  assert.equal(d.action, 'send')
  if (d.action !== 'send') return
  // 뺄 수 있다고 먼저 빼면 사내 모델이 있는데도 답이 얕아진다
  assert.equal(d.model.id, 'int')
  assert.equal(d.chunks.length, 2)
  assert.deepEqual(d.droppedForClass, [])
})

test('감당할 모델이 없으면 상위 등급 청크를 뺀다', () => {
  const d = buildContext({
    chunks: [청크('a', 'public'), 청크('b', 'nda')],
    models: [모델({ id: 'pub', allowedDocClasses: ['public'] })],
  })
  assert.equal(d.action, 'send')
  if (d.action !== 'send') return
  assert.deepEqual(d.chunks.map((c) => c.chunkKey), ['a'])
  // 조용히 빼면 사용자는 그 문서가 없는 줄 안다
  assert.deepEqual(d.droppedForClass.map((c) => c.chunkKey), ['b'])
})

test('조건부 공개까지 되는 모델은 그만큼만 남긴다', () => {
  const d = buildContext({
    chunks: [청크('a', 'public'), 청크('b', 'restricted'), 청크('c', 'nda')],
    models: [모델({ id: 'zdr', allowedDocClasses: ['public', 'restricted'] })],
  })
  assert.equal(d.action, 'send')
  if (d.action !== 'send') return
  assert.deepEqual(d.chunks.map((c) => c.chunkKey).sort(), ['a', 'b'])
  assert.deepEqual(d.droppedForClass.map((c) => c.chunkKey), ['c'])
})

test('공개 청크조차 보낼 모델이 없으면 막는다', () => {
  const d = buildContext({
    chunks: [청크('a', 'public')],
    models: [모델({ enabled: false })],
  })
  assert.equal(d.action, 'blocked')
  if (d.action !== 'blocked') return
  assert.equal(d.reason, 'no_model_for_doc_class')
})

test('컨텍스트가 비면 막는다', () => {
  const d = buildContext({ chunks: [], models: [모델()] })
  assert.equal(d.action, 'blocked')
  if (d.action !== 'blocked') return
  assert.equal(d.reason, 'no_context')
})

test('점수 높은 청크부터 상한까지만 담는다', () => {
  const chunks = Array.from({ length: 30 }, (_, i) => 청크(`c${i}`, 'public', 1 - i * 0.01))
  const d = buildContext({ chunks, models: [모델()] })
  assert.equal(d.action, 'send')
  if (d.action !== 'send') return
  assert.equal(d.chunks.length, DEFAULT_MAX_CHUNKS)
  assert.equal(d.chunks[0].chunkKey, 'c0')
})

test('컨텍스트 본문에 번호와 청크 키가 함께 들어간다', () => {
  const text = renderContext([청크('k1', 'public'), 청크('k2', 'public')])
  assert.match(text, /\[1\|k1\]/)
  assert.match(text, /\[2\|k2\]/)
})

// 인용 검사

test('없는 번호를 인용하면 태그를 지운다', () => {
  const chunks = [청크('a', 'public')]
  const r = checkCitations('예산은 5억이다 [1]. 기간은 12개월이다 [3].', chunks)
  // 근거가 있는 것처럼 보이지만 없는 문장이 가장 위험하다
  assert.deepEqual(r.dropped, [3])
  assert.match(r.text, /\[1\]/)
  assert.equal(r.text.includes('[3]'), false)
  // 문장까지 지우면 맞는 내용도 함께 사라진다
  assert.match(r.text, /기간은 12개월이다/)
})

test('맞는 인용만 있으면 그대로 둔다', () => {
  const chunks = [청크('a', 'public'), 청크('b', 'public')]
  const r = checkCitations('가 [1] 나 [2]', chunks)
  assert.deepEqual(r.dropped, [])
  assert.equal(r.used.length, 2)
})

test('같은 번호를 여러 번 인용해도 한 번만 센다', () => {
  const r = checkCitations('가 [1] 나 [1]', [청크('a', 'public')])
  assert.equal(r.used.length, 1)
})

test('답변에 근거와 AI 고지가 붙는다', () => {
  const chunks = [청크('a', 'public')]
  const a = buildAnswer('예산은 5억이다 [1].', chunks, 'gemini-2.5-pro', 2)
  assert.equal(a.citations.length, 1)
  assert.equal(a.citations[0].chunkKey, 'a')
  assert.deepEqual(a.citations[0].blockIds, ['b-a'])
  assert.equal(a.droppedForClass, 2)
  // AI 기본법 투명성 의무
  assert.equal(a.notice, AI_NOTICE)
  assert.equal(a.modelId, 'gemini-2.5-pro')
})

test('지운 인용 횟수를 남긴다', () => {
  const a = buildAnswer('가 [5] 나 [9]', [청크('a', 'public')], 'm', 0)
  // 많으면 프롬프트를 고쳐야 한다
  assert.equal(a.droppedCitations, 2)
})

test('답변 프롬프트가 자료 밖 생성을 막는다', () => {
  const p = buildAnswerInstruction()
  assert.match(p, /자료에 없는 내용을 만들지 않는다/)
  assert.match(p, /자료에서 찾지 못했다/)
})
