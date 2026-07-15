import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWithConcurrency } from './concurrency.ts'

test('runWithConcurrency: 결과 순서가 입력 순서와 동일 (지연 역순이어도)', async () => {
  const items = [30, 10, 20]
  const out = await runWithConcurrency(items, 3, async (ms) => {
    await new Promise((r) => setTimeout(r, ms))
    return ms
  })
  assert.deepEqual(
    out.map((r) => (r.ok ? r.value : null)),
    [30, 10, 20],
  )
})

test('runWithConcurrency: 빈 배열', async () => {
  const out = await runWithConcurrency<number, number>([], 4, async (n) => n)
  assert.deepEqual(out, [])
})

test('runWithConcurrency: 동시 실행이 limit 초과 안 함', async () => {
  let active = 0
  let maxActive = 0
  const items = Array.from({ length: 10 }, (_, i) => i)
  await runWithConcurrency(items, 3, async (i) => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise((r) => setTimeout(r, 5))
    active -= 1
    return i
  })
  assert.ok(maxActive <= 3, `maxActive=${maxActive} should be <= 3`)
})

test('runWithConcurrency: worker 예외 → retries 후 ok:false, 나머지는 정상 진행', async () => {
  const items = [1, 2, 3]
  const out = await runWithConcurrency(
    items,
    3,
    async (n) => {
      if (n === 2) throw new Error('boom')
      return n * 10
    },
    { retries: 1, backoffMs: 1 },
  )
  assert.equal(out[0].ok, true)
  if (out[0].ok) assert.equal(out[0].value, 10)
  assert.equal(out[1].ok, false)
  if (!out[1].ok) assert.equal(out[1].error.message, 'boom')
  assert.equal(out[2].ok, true)
  if (out[2].ok) assert.equal(out[2].value, 30)
})

test('runWithConcurrency: 실패한 항목은 retries 횟수만큼 재시도 후 성공하면 ok:true', async () => {
  let calls = 0
  const out = await runWithConcurrency(
    [1],
    1,
    async () => {
      calls += 1
      if (calls < 3) throw new Error('fail-once')
      return 'done'
    },
    { retries: 2, backoffMs: 1 },
  )
  assert.equal(calls, 3)
  assert.equal(out[0].ok, true)
  if (out[0].ok) assert.equal(out[0].value, 'done')
})

test('runWithConcurrency: 지수 백오프 간격 증가', async () => {
  const timestamps: number[] = []
  await runWithConcurrency(
    [1],
    1,
    async () => {
      timestamps.push(Date.now())
      throw new Error('always fails')
    },
    { retries: 3, backoffMs: 20 },
  )
  // 4 attempts total (initial + 3 retries) → 3 gaps: ~20, ~40, ~80
  assert.equal(timestamps.length, 4)
  const gaps = [
    timestamps[1] - timestamps[0],
    timestamps[2] - timestamps[1],
    timestamps[3] - timestamps[2],
  ]
  assert.ok(gaps[0] >= 15, `gap0=${gaps[0]}`)
  assert.ok(gaps[1] >= gaps[0] * 1.5, `gap1=${gaps[1]} should be notably > gap0=${gaps[0]}`)
  assert.ok(gaps[2] >= gaps[1] * 1.5, `gap2=${gaps[2]} should be notably > gap1=${gaps[1]}`)
})

test('runWithConcurrency: signal 중단 시 미착수 항목 실행 안 됨', async () => {
  const controller = new AbortController()
  const executed: number[] = []
  const items = [1, 2, 3, 4, 5]
  const out = await runWithConcurrency(
    items,
    1,
    async (i) => {
      executed.push(i)
      if (i === 2) controller.abort()
      await new Promise((r) => setTimeout(r, 1))
      return i
    },
    { signal: controller.signal },
  )
  assert.deepEqual(executed, [1, 2])
  assert.equal(out[0]?.ok, true)
  assert.equal(out[1]?.ok, true)
  assert.equal(out[2], undefined)
  assert.equal(out[3], undefined)
  assert.equal(out[4], undefined)
})
