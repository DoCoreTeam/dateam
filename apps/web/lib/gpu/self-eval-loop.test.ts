import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isConverged, failingKeys, noProgress, buildRefineFeedback, runSelfEvalLoop,
  type CritiqueVerdict,
} from './self-eval-loop.ts'

const V = (fields: Array<[string, boolean]>, missing: string[] = []): CritiqueVerdict => ({
  fields: fields.map(([field, pass]) => ({ field, pass })), missing,
})

test('isConverged — 전 필드 pass + 누락 0', () => {
  assert.equal(isConverged(V([['model', true], ['price', true]])), true)
  assert.equal(isConverged(V([['model', true], ['price', false]])), false)
  assert.equal(isConverged(V([['model', true]], ['supplier'])), false)
})

test('failingKeys — 실패필드 + 누락 합집합', () => {
  const s = failingKeys(V([['model', true], ['price', false]], ['supplier']))
  assert.deepEqual([...s].sort(), ['price', 'supplier'])
})

test('noProgress — 실패집합 안 줄면 정체, 줄면 진전', () => {
  assert.equal(noProgress(null, V([['price', false]])), false)               // 첫 회
  assert.equal(noProgress(V([['price', false]]), V([['price', false]])), true)  // 동일 → 정체
  assert.equal(noProgress(V([['price', false], ['model', false]]), V([['price', false]])), false) // 줄음 → 진전
  assert.equal(noProgress(V([['price', false]]), V([['model', false]])), false) // 다른 실패 → 변화
  assert.equal(noProgress(V([['price', false]]), V([['price', true]])), false)  // 해결 → 진전
})

test('buildRefineFeedback — 실패필드·누락만 겨냥', () => {
  const fb = buildRefineFeedback({ fields: [{ field: 'price', pass: false, reason: 'C7=2.4 인데 24로 추출' }], missing: ['supplier'] })
  assert.ok(fb.includes('price'))
  assert.ok(fb.includes('C7=2.4'))
  assert.ok(fb.includes('supplier'))
})

test('runSelfEvalLoop — 1회 수렴', async () => {
  let calls = 0
  const r = await runSelfEvalLoop({
    extract: async () => { calls++; return { v: 1 } },
    critic: async () => V([['model', true], ['price', true]]),
  })
  assert.equal(r.outcome, 'converged')
  assert.equal(r.attempts, 1)
  assert.equal(r.needsHuman, false)
  assert.equal(calls, 1)
})

test('runSelfEvalLoop — 2회차에 수렴(피드백 반영)', async () => {
  let attempt = 0
  const fbSeen: Array<string | undefined> = []
  const r = await runSelfEvalLoop({
    extract: async (fb) => { fbSeen.push(fb); attempt++; return { attempt } },
    critic: async (res: { attempt: number }) => res.attempt >= 2 ? V([['price', true]]) : V([['price', false]]),
  })
  assert.equal(r.outcome, 'converged')
  assert.equal(r.attempts, 2)
  assert.equal(fbSeen[0], undefined)      // 첫 회 피드백 없음
  assert.ok((fbSeen[1] ?? '').includes('price')) // 둘째 회 실패필드 피드백 주입
})

test('runSelfEvalLoop — no-progress면 조기 중단 + needsHuman', async () => {
  let calls = 0
  const r = await runSelfEvalLoop({
    extract: async () => { calls++; return {} },
    critic: async () => V([['price', false]]),  // 매번 동일 실패
    maxAttempts: 5,
  })
  assert.equal(r.outcome, 'no_progress')
  assert.equal(r.needsHuman, true)
  assert.equal(calls, 2)  // 첫 추출 + 1회 재시도 후 정체 감지
})

test('runSelfEvalLoop — maxAttempts 소진 시 exhausted + needsHuman', async () => {
  let n = 0
  const r = await runSelfEvalLoop({
    extract: async () => ({}),
    // 매번 다른 필드가 실패 → no-progress 아님 → maxAttempts까지 감
    critic: async () => { n++; return V([[`f${n}`, false]]) },
    maxAttempts: 3,
  })
  assert.equal(r.outcome, 'exhausted')
  assert.equal(r.attempts, 3)
  assert.equal(r.needsHuman, true)
})
