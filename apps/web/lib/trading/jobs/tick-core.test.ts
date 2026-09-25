/**
 * 「진 실행은 밖으로 안 나간다」를 실제로 센다
 *
 * 유일 키는 **저장**을 막지 호출을 막지 않는다. 두 크론이 같은 봉에 들어오면
 * 둘 다 Jev 를 부르고 나서 둘째가 저장에 실패한다 — 돈은 두 번 나갔고,
 * 1-C 에서는 알림도 두 번 간다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runJudges, scheduledMinuteOf, RUN_BUDGET_MS, type TickPorts } from './tick-core.ts'
import type { Judge, JudgeName, JudgeInput, JudgeResult } from '../judge/types.ts'

const INPUT = {} as JudgeInput

function countingJudge(name: JudgeName, counter: { n: number }): Judge {
  return {
    name,
    async judge(): Promise<JudgeResult> {
      counter.n += 1
      return { status: 'completed', rawScore: { p_long: 0.5, p_short: 0.2, p_hold: 0.3, enter_now: 0.6 } }
    },
  }
}

interface Harness {
  ports: TickPorts
  calls: { rule: { n: number }; jev: { n: number } }
  finished: string[]
  clock: { at: number }
}

function harness(over: Partial<{
  claim(judge: JudgeName): Promise<string | null>
  takeOver(judge: JudgeName): Promise<string | null>
}> = {}): Harness {
  const calls = { rule: { n: 0 }, jev: { n: 0 } }
  const finished: string[] = []
  const clock = { at: Date.parse('2026-09-25T01:15:05.000Z') }
  const judges = new Map<JudgeName, Judge>([
    ['rule', countingJudge('rule', calls.rule)],
    ['jev', countingJudge('jev', calls.jev)],
  ])
  const ports: TickPorts = {
    claim: over.claim ?? (async (j) => `id-${j}`),
    takeOver: over.takeOver ?? (async () => null),
    judges,
    async finish(id, judge) { finished.push(`${judge}:${id}`) },
    now: () => new Date(clock.at),
  }
  return { ports, calls, finished, clock }
}

test('선점에 성공하면 판단기를 부르고 결과를 저장한다', async () => {
  const h = harness()
  const outcome = await runJudges(['rule', 'jev'], INPUT, h.ports, new Date(h.clock.at))
  assert.deepEqual(outcome.ran, ['rule', 'jev'])
  assert.deepEqual(h.finished, ['rule:id-rule', 'jev:id-jev'])
  assert.equal(h.calls.jev.n, 1)
})

test('★ 남이 먼저 잡았으면 판단기를 0회 부른다 — 이 한 줄이 이중 호출을 막는 전부다', async () => {
  const h = harness({ claim: async () => null, takeOver: async () => null })
  const outcome = await runJudges(['rule', 'jev'], INPUT, h.ports, new Date(h.clock.at))
  assert.deepEqual(outcome.ran, [])
  assert.deepEqual(outcome.skipped, ['rule', 'jev'])
  assert.equal(h.calls.jev.n, 0, '진 실행이 Jev 를 불렀다 — 돈이 두 번 나간다')
  assert.equal(h.calls.rule.n, 0)
  assert.deepEqual(h.finished, [])
})

test('★ 두 실행이 동시에 들어와도 하나만 나간다', async () => {
  // 실제 DB 의 유일 키를 흉내낸다: 먼저 부른 쪽만 id 를 받는다
  const taken = new Set<string>()
  const claim = async (judge: JudgeName) => {
    if (taken.has(judge)) return null
    taken.add(judge)
    return `id-${judge}`
  }
  const a = harness({ claim })
  const b = harness({ claim })
  const started = new Date(a.clock.at)

  const [first, second] = await Promise.all([
    runJudges(['rule', 'jev'], INPUT, a.ports, started),
    runJudges(['rule', 'jev'], INPUT, b.ports, started),
  ])

  const totalJev = a.calls.jev.n + b.calls.jev.n
  assert.equal(totalJev, 1, `Jev 가 ${totalJev}번 나갔다`)
  assert.equal(first.ran.length + second.ran.length, 2, '둘을 합쳐 판단기 둘이 한 번씩 돌아야 한다')
})

test('★ 60초 넘게 멈춘 선점은 이어받는다 — 사고 하나가 하루를 망치지 않게', async () => {
  const h = harness({ claim: async () => null, takeOver: async (j) => `taken-${j}` })
  const outcome = await runJudges(['rule'], INPUT, h.ports, new Date(h.clock.at))
  assert.deepEqual(outcome.ran, ['rule'])
  assert.deepEqual(h.finished, ['rule:taken-rule'])
})

test('★ 50초가 넘으면 남은 판단기를 다음 실행으로 넘긴다', async () => {
  const h = harness()
  const started = new Date(h.clock.at)
  // 첫 판단기가 도는 동안 시계가 51초 지난다
  const slow = new Map(h.ports.judges)
  slow.set('rule', {
    name: 'rule',
    async judge(): Promise<JudgeResult> {
      h.clock.at += RUN_BUDGET_MS + 1_000
      return { status: 'completed', rawScore: { p_long: 0.5, p_short: 0.2, p_hold: 0.3, enter_now: 0.6 } }
    },
  })
  const outcome = await runJudges(['rule', 'jev'], INPUT, { ...h.ports, judges: slow }, started)

  assert.deepEqual(outcome.ran, ['rule'])
  assert.deepEqual(outcome.deferred, ['jev'], '시간이 넘었는데 계속 불렀다 — 함수가 죽으면 그 분 기록이 통째로 없다')
  assert.equal(h.calls.jev.n, 0)
})

test('등록 안 된 판단기는 건너뛴다 — 없는 것을 부르지 않는다', async () => {
  const h = harness()
  const outcome = await runJudges(['rule', 'ml'], INPUT, h.ports, new Date(h.clock.at))
  assert.deepEqual(outcome.ran, ['rule'])
  assert.deepEqual(outcome.skipped, ['ml'])
})

test('판단기마다 선점이 따로다 — 느린 쪽이 빠른 쪽을 끌고 내려가지 않는다', async () => {
  const h = harness({ claim: async (j) => (j === 'jev' ? null : `id-${j}`) })
  const outcome = await runJudges(['rule', 'jev'], INPUT, h.ports, new Date(h.clock.at))
  assert.deepEqual(outcome.ran, ['rule'], 'Jev 를 남이 잡았다고 rule 기록까지 빠졌다')
  assert.deepEqual(outcome.skipped, ['jev'])
})

test('예정 분은 초와 밀리초를 떨어뜨린다 — 같은 분이 한 값이어야 유일 키가 선다', () => {
  assert.equal(scheduledMinuteOf(new Date('2026-09-25T01:15:05.123Z')).toISOString(),
    '2026-09-25T01:15:00.000Z')
  assert.equal(scheduledMinuteOf(new Date('2026-09-25T01:15:59.999Z')).toISOString(),
    '2026-09-25T01:15:00.000Z')
})
