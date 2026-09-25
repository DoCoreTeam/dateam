/**
 * 5분 봉과 미결제약정이 **실제로 저장되는가**
 *
 * `aggregateBars` 는 단정 15개로 검증돼 있었는데 아무도 안 불렀다(실측 2026-09-26).
 * 그래서 여기서는 계산이 맞는가가 아니라 **불리는가**를 본다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closesBucket, bucketStartOf, bucketsClosedBy, openInterestOf, ROLLUP_TIMEFRAMES } from './rollup.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const at = (iso: string) => new Date(iso)

test('★ 구간을 닫는 분에서만 묶는다 — 중간에 묶으면 안 온 분을 빼고 묶는다', () => {
  // 01:00~01:04 가 한 구간. 닫는 것은 01:04 다
  assert.equal(closesBucket(at('2026-09-25T01:00:00Z'), '5m'), false)
  assert.equal(closesBucket(at('2026-09-25T01:03:00Z'), '5m'), false)
  assert.equal(closesBucket(at('2026-09-25T01:04:00Z'), '5m'), true)
  assert.equal(closesBucket(at('2026-09-25T01:09:00Z'), '5m'), true)
  assert.equal(closesBucket(at('2026-09-25T01:10:00Z'), '5m'), false)
})

test('구간 시작이 자정 눈금으로 나뉜다 — 09:00·09:05 가 되어 거래소와 맞는다', () => {
  assert.equal(bucketStartOf(at('2026-09-25T01:04:00Z'), '5m').toISOString(), '2026-09-25T01:00:00.000Z')
  assert.equal(bucketStartOf(at('2026-09-25T01:09:00Z'), '5m').toISOString(), '2026-09-25T01:05:00.000Z')
})

test('1분은 묶음이 아니다', () => {
  assert.equal(closesBucket(at('2026-09-25T01:04:00Z'), '1m'), false)
})

test('지금 닫히는 묶음을 한 번에 알려 준다', () => {
  assert.deepEqual(bucketsClosedBy(at('2026-09-25T01:03:00Z')), [])
  const closed = bucketsClosedBy(at('2026-09-25T01:04:00Z'))
  assert.equal(closed.length, 1)
  assert.equal(closed[0].tf, '5m')
  assert.equal(closed[0].from.toISOString(), '2026-09-25T01:00:00.000Z')
})

test('1-A 가 모으는 묶음은 5분뿐이다 — 15분은 1-B 비교에서 켠다', () => {
  assert.deepEqual([...ROLLUP_TIMEFRAMES], ['5m'])
})

test('★ 미결제약정을 못 읽으면 0 이 아니라 null 이다 — 0 은 「없다」가 아니라 「0 계약」이다', () => {
  assert.equal(openInterestOf(null), null)
  assert.equal(openInterestOf({}), null)
  assert.equal(openInterestOf({ hts_otst_stpl_qty: '' }), null)
  assert.equal(openInterestOf({ hts_otst_stpl_qty: '없음' }), null)
  assert.equal(openInterestOf({ hts_otst_stpl_qty: '123456' }), 123456)
  assert.equal(openInterestOf({ hts_otst_stpl_qty: '0' }), 0)
})

// ── 배선 ─────────────────────────────────────────────────

test('★ 크론이 5분 봉을 실제로 만들어 저장한다', () => {
  const tick = readFileSync(join(HERE, '..', 'jobs', 'tick.ts'), 'utf8')
  assert.match(tick, /aggregateBars\(/, '5분 봉을 안 만든다')
  assert.match(tick, /bucketsClosedBy\(/, '언제 묶을지를 안 묻는다')
  assert.match(tick, /tf: bucket\.tf/, '묶은 봉을 저장하지 않는다')
})

test('★ 크론이 시세를 불러 미결제약정을 채운다 — 명세 §6.1 의 수집 항목이다', () => {
  const tick = readFileSync(join(HERE, '..', 'jobs', 'tick.ts'), 'utf8')
  assert.match(tick, /kis\.price\(/, '시세를 안 부른다 — 미결제약정이 영원히 null 이다')
  assert.match(tick, /openInterestOf\(/, '받아 놓고 봉에 안 넣는다')
})

test('★ 시세·호가가 실패해도 봉 저장을 막지 않는다 — 모으는 일이 먼저다', () => {
  const tick = readFileSync(join(HERE, '..', 'jobs', 'tick.ts'), 'utf8')
  const priceAt = tick.indexOf('kis.price(')
  const saveAt = tick.indexOf('saveBars({')
  assert.ok(priceAt > 0 && saveAt > priceAt, '순서를 못 찾았다')

  // 시세 실패로 되돌아가는 길이 저장 앞에 있으면 안 된다
  const between = tick.slice(priceAt, saveAt)
  assert.doesNotMatch(between, /return \{ ok: false/,
    '시세가 실패하면 봉을 안 남기고 돌아간다 — 그 분이 통째로 결측이 된다')
  assert.match(tick, /side_failed=/, '실패 사실이 사유에 안 남는다')
})
