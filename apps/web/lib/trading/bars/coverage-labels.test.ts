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

test('★ 실측한 아홉 날이 셋으로 갈린다', () => {
  // 2026-09-19 토, 20 일, 21~25 평일, 26 토, 27 일. 크론 첫 실행은 9/26
  const SINCE = '2026-09-26'
  const 주말 = ['2026-09-19', '2026-09-20', '2026-09-26', '2026-09-27']
  const 시작전 = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']
  for (const d of 주말) assert.equal(emptyDayKind(d, SINCE), 'weekend', d)
  for (const d of 시작전) assert.equal(emptyDayKind(d, SINCE), 'before_start', d)
  const kinds = new Set(Object.values(EMPTY_DAY_LABEL))
  assert.equal(kinds.size, 3, '셋을 같은 말로 적으면 아홉 줄이 다 고칠 것으로 보인다')
})

test('★ 수집이 시작된 뒤에 빠진 날은 「시작 전」이 아니다', () => {
  /*
    이 둘을 섞으면 진짜로 물어야 할 날이 「물을 것 없는 날」로 숨는다.
    수집이 돌고 있는데 빠진 날이야말로 원인을 찾아야 하는 날이다.
  */
  assert.equal(emptyDayKind('2026-09-28', '2026-09-26'), 'not_collected', '시작 뒤 평일')
  assert.equal(emptyDayKind('2026-09-26', '2026-09-26'), 'weekend', '시작한 날이 주말이면 주말이 먼저')
  assert.equal(emptyDayKind('2026-09-25', '2026-09-26'), 'before_start', '시작 하루 전')
})

test('시작일을 모르면 「시작 전」이라고 단정하지 않는다', () => {
  // 모르는 것과 아는 것을 같은 말로 적으면 그 말이 뜻을 잃는다
  assert.equal(emptyDayKind('2026-09-21'), 'not_collected')
  assert.equal(emptyDayKind('2026-09-21', null), 'not_collected')
})

test('날짜를 UTC 자정으로 읽어 하루 밀리지 않는다', () => {
  // `new Date('2026-09-28')` 은 UTC 자정이라 서울에서 읽으면 09:00 이다 — 요일이 안 밀리는지 본다
  assert.equal(isWeekendDate('2026-09-28'), false, '월요일')
  assert.equal(isWeekendDate('2026-09-27'), true, '일요일')
  assert.equal(isWeekendDate('2026-10-03'), true, '토요일')
  assert.equal(isWeekendDate('2026-10-05'), false, '월요일')
})

test('★ 안 서는 날에 결측을 세지 않는다', () => {
  const 주말줄 = {
    tradeDate: '2026-09-27', expected: 0, actual: 0, unknown: true,
    sameDayExitAt: null, collectingSince: '2026-09-26',
  }
  assert.equal(missingCount(주말줄), 0, '안 오는 것이 정상인 날에 결측을 세면 늘 빨갛다')
})

test('세 줄의 안내가 서로 다른 일을 시킨다', () => {
  assert.equal(new Set(Object.values(EMPTY_DAY_HINT)).size, 3)
  // 「시작 전」에는 물을 것이 없다 — 대신 할 수 있는 일을 짚는다
  assert.match(EMPTY_DAY_HINT.before_start, /CSV/, '없는 과거를 채울 길을 안 알려 준다')
  assert.doesNotMatch(EMPTY_DAY_HINT.before_start, /빠졌|결측/, '물을 것이 없는 날을 고장처럼 말한다')
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

test('★ 화면이 수집 시작일을 실제로 넘긴다 — 안 넘기면 늘 「안 모은 날」이다', () => {
  const src = readFileSync(join(HERE, '..', '..', '..', TRADING_APP_DIR, 'BarCoverage.tsx'), 'utf8')
  assert.match(src, /emptyDayKind\(d\.tradeDate, d\.collectingSince\)/,
    '시작일을 안 넘긴다 — 셋으로 가르는 규칙이 둘로만 돈다')
})
