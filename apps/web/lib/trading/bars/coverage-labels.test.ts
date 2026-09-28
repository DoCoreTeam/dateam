/**
 * 가드 — **고칠 것이 없는 날과 고칠 것이 있는 날을 가른다**
 *
 * 실측 2026-09-28: 수집 상태 아홉 줄이 전부 「세션 정보 없음」이었는데
 * 그중 넷은 토·일이었다. 사람이 아홉 줄을 보고 아홉 개를 고쳐야 하는 줄 안다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { emptyDayKind, isWeekendDate, EMPTY_DAY_LABEL, EMPTY_DAY_HINT } from './coverage-labels.ts'
import { missingCount } from '../overview-shape.ts'
import { TRADING_APP_DIR } from '../../policy/app-dirs.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

test('★ 실측한 아홉 날이 둘로 갈린다', () => {
  // 2026-09-19 토, 20 일, 21~25 평일, 26 토, 27 일
  const 주말 = ['2026-09-19', '2026-09-20', '2026-09-26', '2026-09-27']
  const 평일 = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']
  for (const d of 주말) assert.equal(emptyDayKind(d), 'weekend', d)
  for (const d of 평일) assert.equal(emptyDayKind(d), 'not_collected', d)
  assert.notEqual(EMPTY_DAY_LABEL.weekend, EMPTY_DAY_LABEL.not_collected,
    '둘을 같은 말로 적으면 아홉 줄이 다 고칠 것으로 보인다')
})

test('날짜를 UTC 자정으로 읽어 하루 밀리지 않는다', () => {
  // `new Date('2026-09-28')` 은 UTC 자정이라 서울에서 읽으면 09:00 이다 — 요일이 안 밀리는지 본다
  assert.equal(isWeekendDate('2026-09-28'), false, '월요일')
  assert.equal(isWeekendDate('2026-09-27'), true, '일요일')
  assert.equal(isWeekendDate('2026-10-03'), true, '토요일')
  assert.equal(isWeekendDate('2026-10-05'), false, '월요일')
})

test('★ 안 서는 날에 결측을 세지 않는다', () => {
  const 주말줄 = { tradeDate: '2026-09-27', expected: 0, actual: 0, unknown: true, sameDayExitAt: null }
  assert.equal(missingCount(주말줄), 0, '안 오는 것이 정상인 날에 결측을 세면 늘 빨갛다')
})

test('두 줄의 안내가 서로 다른 일을 시킨다', () => {
  assert.notEqual(EMPTY_DAY_HINT.weekend, EMPTY_DAY_HINT.not_collected)
  assert.match(EMPTY_DAY_HINT.weekend, /맞습니다|정상/, '고칠 것이 없다는 사실을 안 말한다')
  assert.doesNotMatch(EMPTY_DAY_HINT.weekend, /빠진|결측|모자/, '주말인데 뭔가 모자란 것처럼 말한다')
})

test('★ 화면이 그 갈래를 실제로 그린다 — 만들어만 두지 않는다', () => {
  const src = readFileSync(join(HERE, '..', '..', '..', TRADING_APP_DIR, 'BarCoverage.tsx'), 'utf8')
  assert.ok(src.includes('EMPTY_DAY_LABEL') || src.includes('emptyDayKind'),
    '갈래를 안 부른다 — 부르지 않으면 아홉 줄이 그대로 한 말이다')
  assert.ok(!src.includes("'세션 정보 없음'") && !src.includes('세션 정보 없음'),
    '화면이 옛 한 마디를 아직 들고 있다')
})
