/**
 * 백필 계획 — **끝나는가**, **이미 있는 것을 다시 안 받는가**
 *
 * 이어 조회는 끝나는 조건이 틀리면 영원히 안 끝난다. 같은 102건을 계속 다시 받으면서
 * 화면에는 「받는 중」만 뜬다 — 오류가 안 나므로 아무도 못 알아본다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  missingRanges, chunkRange, plannedCallCount, shouldContinue, MAX_BARS_PER_CALL,
} from './plan.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIN = 60_000
const T0 = Date.parse('2026-09-25T01:00:00.000Z')
const win = (fromMin: number, toMin: number) => ({ fromMs: T0 + fromMin * MIN, toMs: T0 + toMin * MIN })
const held = (...mins: number[]) => ({ startAtMs: mins.map((m) => T0 + m * MIN) })

test('아무것도 없으면 구간 전체가 구멍이다', () => {
  assert.deepEqual(missingRanges(win(0, 10), held()), [win(0, 10)])
})

test('★ 이미 있는 자리는 다시 안 받는다 — 호출 한도를 그만큼 낭비한다', () => {
  const gaps = missingRanges(win(0, 10), held(0, 1, 2, 3, 4))
  assert.deepEqual(gaps, [win(5, 10)])
})

test('가운데가 비면 그 구멍만 받는다', () => {
  const gaps = missingRanges(win(0, 10), held(0, 1, 2, 7, 8, 9))
  assert.deepEqual(gaps, [win(3, 7)])
})

test('구멍이 여럿이면 여럿을 돌려준다', () => {
  const gaps = missingRanges(win(0, 10), held(0, 3, 4, 8))
  assert.deepEqual(gaps, [win(1, 3), win(5, 8), win(9, 10)])
})

test('다 있으면 받을 것이 없다', () => {
  assert.deepEqual(missingRanges(win(0, 3), held(0, 1, 2)), [])
})

// ── 이어 조회 ────────────────────────────────────────────

test('★ 조각의 물어볼 시각이 반드시 앞으로 간다 — 안 그러면 영원히 안 끝난다', () => {
  const chunks = chunkRange(win(0, 500))
  assert.ok(chunks.length > 1, '500분을 한 번에 받으려 한다')
  for (let i = 1; i < chunks.length; i += 1) {
    assert.ok(chunks[i].untilMs < chunks[i - 1].untilMs,
      `${i}번째 조각이 앞으로 안 갔다 — 같은 102건을 다시 받는다`)
  }
  // 마지막 조각이 구간 시작에 닿는다
  assert.equal(chunks[chunks.length - 1].fromMs, win(0, 500).fromMs)
})

test('한 조각이 1회 상한(102건)을 안 넘는다', () => {
  for (const chunk of chunkRange(win(0, 500))) {
    const minutes = (chunk.untilMs - chunk.fromMs) / MIN
    assert.ok(minutes <= MAX_BARS_PER_CALL, `조각이 ${minutes}분이다 — 1회 상한을 넘는다`)
  }
})

test('상한보다 짧은 구간은 한 번이면 된다', () => {
  assert.equal(chunkRange(win(0, 50)).length, 1)
  assert.equal(chunkRange(win(0, MAX_BARS_PER_CALL)).length, 1)
  assert.equal(chunkRange(win(0, MAX_BARS_PER_CALL + 1)).length, 2)
})

test('빈 구간은 조각이 0개다', () => {
  assert.deepEqual(chunkRange(win(5, 5)), [])
  assert.deepEqual(chunkRange(win(5, 3)), [])
})

test('몇 번 물어야 하는지 미리 셀 수 있다 — 화면이 진행을 말하려면 필요하다', () => {
  assert.equal(plannedCallCount(win(0, 500), held()), chunkRange(win(0, 500)).length)
  assert.equal(plannedCallCount(win(0, 10), held(0, 1, 2, 3, 4, 5, 6, 7, 8, 9)), 0)
})

// ── 멈추는 조건 ──────────────────────────────────────────

test('★ 실패가 이어지면 멈춘다 — 막힌 채 수백 번 더 물으면 실시간 수집까지 죽는다', () => {
  assert.equal(shouldContinue({ planned: 100, filled: 0, emptyChunks: 0, failed: 0, barsSaved: 0 }, 3), true)
  assert.equal(shouldContinue({ planned: 100, filled: 0, emptyChunks: 0, failed: 2, barsSaved: 0 }, 3), true)
  assert.equal(shouldContinue({ planned: 100, filled: 0, emptyChunks: 0, failed: 3, barsSaved: 0 }, 3), false)
})

// ── 미래 참조 금지 (M5) ──────────────────────────────────

test('★ 백필한 봉의 available_at 이 받은 시각이다 — 그때 알았던 것처럼 만들지 않는다', () => {
  const src = readFileSync(join(HERE, 'minute-backfill.ts'), 'utf8')
  const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  // saveBars 가 confirmedAt 을 available_at 으로 쓴다. 여기 넘기는 값이 now 여야 한다
  assert.match(body, /confirmedAt:\s*now/, 'confirmedAt 에 봉 시각을 넘기면 백테스트가 미래를 본다')
  assert.doesNotMatch(body, /confirmedAt:\s*bars?\[/, '봉 시각을 확정 시각으로 넘긴다')
})

test('★ 받은 구간 밖의 봉은 버린다 — KIS 가 더 주더라도 계획 밖은 안 쓴다', () => {
  const src = readFileSync(join(HERE, 'minute-backfill.ts'), 'utf8')
  assert.match(src, /startAt\.getTime\(\) >= chunk\.fromMs/, '계획 밖 봉을 거르지 않는다')
})
