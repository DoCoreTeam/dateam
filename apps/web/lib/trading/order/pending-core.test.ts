import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickPendingEntry, seoulDaysOf, PLACED_STATUSES, BLOCKING_FALLBACK } from './pending-core.ts'

const sig = (id: string) => ({ id, contractCode: '101W12', direction: 'long' as const })

test('이미 주문 낸 신호는 안 고른다 — 막힐 것을 내면 실패가 쌓여 무장이 풀린다', () => {
  const picked = pickPendingEntry([sig('a'), sig('b')], new Set(['a']))
  assert.equal(picked?.id, 'b')
})

test('전부 주문 냈으면 낼 것이 없다', () => {
  assert.equal(pickPendingEntry([sig('a')], new Set(['a'])), null)
  assert.equal(pickPendingEntry([], new Set()), null)
})

test('가장 최근 것 하나만 — 오래된 신호는 그때 가격이 아니다', () => {
  // 들어오는 순서가 최신 순이다
  const picked = pickPendingEntry([sig('new'), sig('old')], new Set())
  assert.equal(picked?.id, 'new')
})

test('같은 날 여러 번 주문해도 하루다', () => {
  assert.equal(seoulDaysOf([
    '2026-09-26T00:30:00Z', '2026-09-26T03:00:00Z',
  ]), 1)
})

test('서울 날짜로 센다 — UTC 로 세면 장 마감 뒤 주문이 다음 날이 된다', () => {
  // UTC 로는 25일과 26일이지만 서울에서는 둘 다 26일 장중이다
  assert.equal(seoulDaysOf(['2026-09-25T23:50:00Z', '2026-09-26T04:00:00Z']), 1)
})

test('시각을 못 읽은 줄은 안 센다 — 부풀리면 관문이 일찍 열린다', () => {
  assert.equal(seoulDaysOf(['말이 안 되는 값', '2026-09-26T00:30:00Z']), 1)
  assert.equal(seoulDaysOf(['말이 안 되는 값']), 0)
})

test('낼 준비만 한 주문은 실적이 아니다', () => {
  assert.deepEqual([...PLACED_STATUSES], ['sent', 'unknown'])
  assert.equal(PLACED_STATUSES.includes('pending' as never), false)
  // 실패한 주문도 실적이 아니다
  assert.equal(PLACED_STATUSES.includes('failed' as never), false)
})

test('못 읽으면 막는 쪽이다 — 모름이 허가가 되면 안 된다', () => {
  assert.equal(BLOCKING_FALLBACK.gate.passed, false)
  assert.ok(BLOCKING_FALLBACK.gate.insufficient > 0)
  assert.equal(BLOCKING_FALLBACK.paperAutoDays, 0)
  // 0 이면 「오늘 게이트 실패 없음」이라는 허가가 된다
  assert.ok(BLOCKING_FALLBACK.gateFailCount > 0)
})
