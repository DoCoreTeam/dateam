import { test } from 'node:test'
import assert from 'node:assert/strict'
import { retryPlan, retryNote } from './retry-core.ts'

const base = {
  maxAttempts: 2, delayMs: 3_000, elapsedMs: 5_000, budgetMs: 50_000, perAttemptMs: 1_000,
}

test('예산이 넉넉하면 설정한 횟수만큼 묻는다', () => {
  assert.deepEqual(retryPlan(base), { attempts: 2, delayMs: 3_000, reason: 'full' })
})

test('★ 횟수가 0 이면 다시 안 묻는다 — 끄는 길이 있어야 한다', () => {
  assert.deepEqual(retryPlan({ ...base, maxAttempts: 0 }),
    { attempts: 0, delayMs: 0, reason: 'disabled' })
})

test('간격이 0 이하면 다시 안 묻는다 — 쉬지 않고 두 번 물어도 답은 같다', () => {
  assert.equal(retryPlan({ ...base, delayMs: 0 }).reason, 'disabled')
  assert.equal(retryPlan({ ...base, delayMs: -1 }).reason, 'disabled')
})

test('★ 예산이 모자라면 줄인다 — 넘기면 감시가 밀리고 그 분의 포지션을 아무도 안 본다', () => {
  // 남은 예산 5초, 한 번에 4초 → 한 번만
  const plan = retryPlan({ ...base, elapsedMs: 45_000, maxAttempts: 2 })
  assert.equal(plan.attempts, 1)
  assert.equal(plan.reason, 'budget_limited')
})

test('★ 예산이 한 번치도 안 남으면 아예 안 묻는다', () => {
  const plan = retryPlan({ ...base, elapsedMs: 49_000 })
  assert.deepEqual(plan, { attempts: 0, delayMs: 3_000, reason: 'no_budget' })
})

test('예산이 음수여도 0 회다 — 이미 넘긴 판에서 더 쓰지 않는다', () => {
  assert.equal(retryPlan({ ...base, elapsedMs: 60_000 }).attempts, 0)
})

test('소수 횟수는 내림한다 — 1.9 번 물을 수는 없다', () => {
  assert.equal(retryPlan({ ...base, maxAttempts: 1.9 }).attempts, 1)
})

test('실행 기록에 몇 번 물어 어떻게 됐는지가 남는다', () => {
  assert.equal(retryNote({ attempts: 0, delayMs: 0, reason: 'disabled' }, 0, false), 'bar_retry=0(disabled)')
  assert.equal(retryNote({ attempts: 2, delayMs: 3_000, reason: 'full' }, 1, true), 'bar_retry=1/2,confirmed')
  assert.equal(retryNote({ attempts: 2, delayMs: 3_000, reason: 'full' }, 2, false), 'bar_retry=2/2,still_missing')
})
