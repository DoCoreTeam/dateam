import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  AI_MEMO_FIELD, classifyAiKey, readClassifyAiMemo, toClassifyAiMemo,
} from './classify-ai-memo.ts'

const MODEL = 'gemini-3-flash-preview'
const PROMPT = '제목: 김치찌개 끓이는 법\n주제 후보: 요리, 여행'
const TOPICS = ['t-cook', 't-travel']

test('같은 프롬프트와 모델이면 남긴 답을 다시 쓴다', () => {
  const key = classifyAiKey(PROMPT, MODEL)
  const basis = { reason: 'x', [AI_MEMO_FIELD]: toClassifyAiMemo(key, { topicId: 't-cook', confidence: 0.8, reason: '요리' }) }
  assert.deepEqual(readClassifyAiMemo(basis, classifyAiKey(PROMPT, MODEL), TOPICS),
    { topicId: 't-cook', confidence: 0.8, reason: '요리' })
})

test('「맞는 주제 없음」도 답이라 다시 묻지 않는다', () => {
  const key = classifyAiKey(PROMPT, MODEL)
  const basis = { [AI_MEMO_FIELD]: toClassifyAiMemo(key, { topicId: null, confidence: 0.9, reason: '없음' }) }
  assert.equal(readClassifyAiMemo(basis, key, TOPICS)?.topicId, null)
  assert.notEqual(readClassifyAiMemo(basis, key, TOPICS), null)
})

test('프롬프트 한 글자나 모델이 달라지면 지문이 달라 다시 묻는다', () => {
  const key = classifyAiKey(PROMPT, MODEL)
  const basis = { [AI_MEMO_FIELD]: toClassifyAiMemo(key, { topicId: 't-cook', confidence: 0.8, reason: '요리' }) }
  assert.equal(readClassifyAiMemo(basis, classifyAiKey(PROMPT + '.', MODEL), TOPICS), null)
  assert.equal(readClassifyAiMemo(basis, classifyAiKey(PROMPT, 'gemini-2.5-flash'), TOPICS), null)
})

test('남긴 답이 없거나 깨졌거나 지워진 주제를 가리키면 다시 묻는다', () => {
  const key = classifyAiKey(PROMPT, MODEL)
  assert.equal(readClassifyAiMemo(null, key, TOPICS), null)
  assert.equal(readClassifyAiMemo({ reason: '규칙' }, key, TOPICS), null)
  assert.equal(readClassifyAiMemo({ [AI_MEMO_FIELD]: { key, topicId: 't-cook' } }, key, TOPICS), null)
  const gone = { [AI_MEMO_FIELD]: toClassifyAiMemo(key, { topicId: 't-deleted', confidence: 0.8, reason: '' }) }
  assert.equal(readClassifyAiMemo(gone, key, TOPICS), null)
})

test('분류 단계가 벤더를 부르기 전에 남긴 답을 먼저 보고, 성공한 답만 남긴다', () => {
  const src = readFileSync(new URL('../jobs/stages.ts', import.meta.url), 'utf8')
  const body = src.slice(src.indexOf('export async function runClassify'), src.indexOf('function buildClassifyUpdate'))
  const read = body.indexOf('readClassifyAiMemo(')
  const call = body.indexOf('callGemini(')
  assert.ok(read > 0 && call > 0 && read < call, '남긴 답 확인이 벤더 호출보다 앞에 있어야 한다')
  assert.ok(/if \(llm\)[\s\S]{0,200}toClassifyAiMemo\(/.test(body) || /memo = .*toClassifyAiMemo/.test(body),
    '답을 남기는 자리는 파싱에 성공한 뒤여야 한다')
  assert.ok(/select\([^)]*topic_basis/.test(body), '이전 답을 읽으려면 topic_basis 를 함께 읽어야 한다')
})
