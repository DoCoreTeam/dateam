import { test } from 'node:test'
import assert from 'node:assert/strict'
import { historyPrev, historyNext } from './composer-history.ts'

test('historyPrev: 탐색 시작(-1)이면 가장 최신 인덱스부터', () => {
  assert.equal(historyPrev(-1, 3), 2)
})

test('historyPrev: 위로 갈수록 더 오래된(작은) 인덱스', () => {
  assert.equal(historyPrev(2, 3), 1)
  assert.equal(historyPrev(1, 3), 0)
})

test('historyPrev: 가장 오래된(0)에서 더 올라가도 0 유지', () => {
  assert.equal(historyPrev(0, 3), 0)
})

test('historyPrev: 히스토리 없으면 -1(초안 유지)', () => {
  assert.equal(historyPrev(-1, 0), -1)
})

test('historyNext: 아래로 갈수록 더 최신(큰) 인덱스', () => {
  assert.equal(historyNext(0, 3), 1)
  assert.equal(historyNext(1, 3), 2)
})

test('historyNext: 최신(len-1)을 넘어서면 -1(초안=빈칸 복귀)', () => {
  assert.equal(historyNext(2, 3), -1)
})

test('historyNext: 탐색 안 함(-1)이면 그대로 -1', () => {
  assert.equal(historyNext(-1, 3), -1)
})

test('↑↑↓ 왕복: 최신→직전→다시 최신', () => {
  const len = 3
  const up1 = historyPrev(-1, len) // 2 (최신)
  const up2 = historyPrev(up1, len) // 1
  const down1 = historyNext(up2, len) // 2
  assert.deepEqual([up1, up2, down1], [2, 1, 2])
})
