import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFields, toEvidence, outputSpec } from './parse-fields.ts'
import { MIN_QUOTE_CHARS } from '../report/schema.ts'
import { taskById } from '../report/tasks.ts'

const TASK = taskById('budget')
const FILES = new Map([['b1', 'f1']])
const LONG = '가'.repeat(MIN_QUOTE_CHARS)

function run(body: unknown) {
  return parseFields({ text: JSON.stringify(body), task: TASK, vendor: 'gemini', fileIdByBlock: FILES })
}

test('근거가 있으면 확인, 없으면 미확인 — 기본을 확인으로 두면 전부 확인으로 보인다', () => {
  const withEv = run({ [TASK.fields[0]]: { value: '10억', evidence: [{ blockId: 'b1', quote: LONG }] } })
  assert.equal(withEv[TASK.fields[0]].grounding, 'confirmed')

  const noEv = run({ [TASK.fields[0]]: { value: '10억' } })
  assert.equal(noEv[TASK.fields[0]].grounding, 'unconfirmed')
})

test('짧은 인용은 근거로 안 친다', () => {
  assert.equal(toEvidence({ blockId: 'b1', quote: '사업 기간' }, FILES), null)
  assert.ok(toEvidence({ blockId: 'b1', quote: LONG }, FILES))
})

test('블록 없는 근거는 버린다 — 원문으로 못 돌아가는 근거는 근거가 아니다', () => {
  assert.equal(toEvidence({ quote: LONG }, FILES), null)
})

test('태스크가 요구하지 않은 칸은 버린다 — 지어낸 이름이 리포트 칸이 되면 안 된다', () => {
  const out = run({ [TASK.fields[0]]: { value: 1 }, 지어낸칸: { value: 2 } })
  assert.equal('지어낸칸' in out, false)
})

test('값도 근거도 없으면 칸을 안 만든다 — 빈 칸이 «못 찾음»으로 보여야 한다', () => {
  const out = run({ [TASK.fields[0]]: { value: null, evidence: [] } })
  assert.equal(Object.keys(out).length, 0)
})

test('값만 온 모양도 받는다 — 모델마다 답이 다르다', () => {
  const out = run({ [TASK.fields[0]]: '1,200,000,000' })
  assert.equal(out[TASK.fields[0]].value, '1,200,000,000')
})

test('JSON 이 아예 아니면 그 태스크만 비고 리포트는 산다', () => {
  const out = parseFields({ text: '답을 못 하겠습니다', task: TASK, vendor: 'x', fileIdByBlock: FILES })
  assert.deepEqual(out, {})
})

test('산문에 섞여 온 JSON 도 건진다', () => {
  const out = parseFields({
    text: `알겠습니다.\n\`\`\`json\n{"${TASK.fields[0]}":{"value":"7억"}}\n\`\`\``,
    task: TASK, vendor: 'x', fileIdByBlock: FILES,
  })
  assert.equal(out[TASK.fields[0]].value, '7억')
})

test('확신은 0~1 로 자른다', () => {
  const a = run({ [TASK.fields[0]]: { value: 1, confidence: 3 } })
  assert.equal(a[TASK.fields[0]].confidence, 1)
  const b = run({ [TASK.fields[0]]: { value: 1, confidence: -2 } })
  assert.equal(b[TASK.fields[0]].confidence, 0)
})

test('출력 모양에 태스크의 칸이 전부 들어간다', () => {
  const spec = outputSpec(TASK)
  for (const f of TASK.fields) assert.ok(spec.includes(`"${f}"`), f)
})
