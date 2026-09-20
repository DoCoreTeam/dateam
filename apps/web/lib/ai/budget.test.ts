/**
 * 남은 AI 호출을 아는 자리 (P0030 I07)
 *
 * 여기서 잠그는 계약 셋
 *   ① 상한을 **모르면 막지 않는다** — 관측 장치가 장애 원인이 되면 안 된다
 *   ② 막을 때는 **무엇에 걸렸고 언제 풀리는지**를 함께 말한다
 *   ③ 하루와 분당은 **다른 벽**이다 — 무료 등급의 진짜 벽은 분당이다
 *
 * 실측 2026-09-20: 하루 23,318건(예산의 38.9배), 분당 40.2회(한도 5회의 8배)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decideBudget, toBudgetLimit, nextDailyResetIso,
  type BudgetLimit, type BudgetUsage,
} from './budget.ts'

const limit: BudgetLimit = {
  feature: 'ci-discover', dailyLimit: 50, perMinuteLimit: 2, enabled: true,
}
const usage = (u: Partial<BudgetUsage> = {}): BudgetUsage => ({
  usedToday: 0, usedLastMinute: 0, oldestInWindowIso: null, ...u,
})

test('여유가 있으면 통과하고 남은 횟수를 알려준다', () => {
  const d = decideBudget(limit, usage({ usedToday: 10 }))
  assert.equal(d.allowed, true)
  assert.equal(d.allowed === true && d.remainingToday, 40)
})

test('★ 상한을 모르면 막지 않는다 — 셈이 안 된다고 사용자의 일을 멈추지 않는다', () => {
  const d = decideBudget(null, usage({ usedToday: 999_999 }))
  assert.equal(
    d.allowed, true,
    '원장을 못 읽었다고 AI 를 통째로 막으면 관측 장치가 새 단일 장애점이 된다',
  )
})

test('★ 하루 한도에 닿으면 막고, 언제 풀리는지 말한다', () => {
  const now = new Date('2026-09-20T05:00:00.000Z')   // 한국시간 14시
  const d = decideBudget(limit, usage({ usedToday: 50 }), now)

  assert.equal(d.allowed, false)
  assert.equal(d.allowed === false && d.reason, 'daily')
  assert.match(d.allowed === false ? d.message : '', /50\/50/, '지금 몇 번 썼는지 안 말한다')
  // 글자가 아니라 **시점**을 견준다. 이 저장소의 시간 SSOT 는 +09:00 앵커 문자열을 준다
  assert.equal(
    Date.parse(d.allowed === false ? d.retryAtIso : ''),
    Date.parse('2026-09-20T15:00:00.000Z'),
    '한국시간 다음날 0시여야 한다 (UTC 로는 같은 날 15시)',
  )
})

test('★ 분당 한도는 하루와 다른 벽이다 — 하루치가 남아도 걸린다', () => {
  const now = new Date('2026-09-20T05:00:30.000Z')
  const d = decideBudget(limit, usage({
    usedToday: 3,                                        // 하루치는 47회 남았다
    usedLastMinute: 2,
    oldestInWindowIso: '2026-09-20T05:00:10.000Z',
  }), now)

  assert.equal(d.allowed, false)
  assert.equal(d.allowed === false && d.reason, 'per_minute')
  assert.equal(
    d.allowed === false ? d.retryAtIso : '',
    '2026-09-20T05:01:10.000Z',
    '가장 오래된 호출로부터 60초 뒤에 풀린다',
  )
  assert.match(d.allowed === false ? d.message : '', /40초/, '몇 초 기다리면 되는지 말한다')
})

test('창 시각을 모르면 60초 뒤로 둔다 — 지어낸 시각을 주지 않는다', () => {
  const now = new Date('2026-09-20T05:00:00.000Z')
  const d = decideBudget(limit, usage({ usedLastMinute: 5, oldestInWindowIso: null }), now)
  assert.equal(d.allowed === false && d.retryAtIso, '2026-09-20T05:01:00.000Z')
})

test('하루 한도가 분당보다 먼저 판정된다 — 내일까지 막힌 것을 「40초 뒤」라고 하면 안 된다', () => {
  const d = decideBudget(limit, usage({ usedToday: 50, usedLastMinute: 9 }))
  assert.equal(d.allowed === false && d.reason, 'daily')
})

test('꺼진 기능은 막되 이유를 구분한다', () => {
  const d = decideBudget({ ...limit, enabled: false }, usage())
  assert.equal(d.allowed === false && d.reason, 'disabled')
  assert.match(d.allowed === false ? d.message : '', /켜/, '어떻게 푸는지 말해야 한다')
})

test('하루 한도 0 은 「안 쓴다」로 동작한다', () => {
  const d = decideBudget({ ...limit, dailyLimit: 0 }, usage({ usedToday: 0 }))
  assert.equal(d.allowed, false)
  assert.equal(d.allowed === false && d.reason, 'daily')
})

test('한도 되살아나는 시각은 한국시간 자정이다', () => {
  // 한국시간 2026-09-20 08:59 → 다음 자정은 09-21 00:00 KST = 09-20 15:00 UTC
  assert.equal(
    Date.parse(nextDailyResetIso(new Date('2026-09-19T23:59:00.000Z'))),
    Date.parse('2026-09-20T15:00:00.000Z'),
  )
})

test('★ 이상한 상한 줄은 null 이 된다 — 0 이나 음수로 기능을 조용히 막지 않는다', () => {
  assert.equal(toBudgetLimit(null), null)
  assert.equal(toBudgetLimit({ feature: '', daily_limit: 5, per_minute_limit: 1 }), null)
  assert.equal(toBudgetLimit({ feature: 'x', daily_limit: -1, per_minute_limit: 1 }), null)
  assert.equal(toBudgetLimit({ feature: 'x', daily_limit: 5, per_minute_limit: 0 }), null)
  assert.equal(toBudgetLimit({ feature: 'x', daily_limit: 1.5, per_minute_limit: 1 }), null)
})

test('제대로 된 줄은 그대로 읽힌다', () => {
  const l = toBudgetLimit({ feature: ' ci-discover ', daily_limit: 50, per_minute_limit: 2, enabled: true })
  assert.deepEqual(l, { feature: 'ci-discover', dailyLimit: 50, perMinuteLimit: 2, enabled: true })
})
