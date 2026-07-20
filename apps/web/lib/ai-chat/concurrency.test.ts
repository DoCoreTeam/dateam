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
  // 4 attempts total (initial + 3 retries) → 3 gaps ≈ backoffMs * 3^attempt: 20, 60, 180.
  // setTimeout은 요청한 지연 이상만 보장(조기 발화 없음)하므로, 측정 gap은 항상 기대 백오프 이상이다.
  // 연속 측정 gap의 비율(gap1 >= gap0*1.5)로 검증하면 러너 지터가 짧은 첫 gap에 절대값으로 더해져
  // 비율이 무너지며 flaky해진다. 각 gap을 "기대 백오프의 하한"과 비교해 결정적으로 판정한다.
  assert.equal(timestamps.length, 4)
  const gaps = [
    timestamps[1] - timestamps[0],
    timestamps[2] - timestamps[1],
    timestamps[3] - timestamps[2],
  ]
  // 타이머 슬랙 여유로 0.8배 하한(setTimeout이 드물게 1~2ms 일찍 계상되는 환경 방어)
  assert.ok(gaps[0] >= 20 * 0.8, `gap0=${gaps[0]} should be >= ~20`)
  assert.ok(gaps[1] >= 60 * 0.8, `gap1=${gaps[1]} should be >= ~60`)
  assert.ok(gaps[2] >= 180 * 0.8, `gap2=${gaps[2]} should be >= ~180`)
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
