import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gateEmptyReason } from './empty-reason.ts'

/** 실측 2026-09-30 */
const REAL = {
  backtestRuns: 0,
  bars: 1222,
  firstBarDay: '2026-09-27',
  lastBarDay: '2026-09-30',
  signals: 0,
  lastRunMessage: null,
}

test('한 번도 안 돌았으면 그렇게 말하고 지금 가진 것을 센다', () => {
  const r = gateEmptyReason(REAL)
  assert.ok(r)
  assert.equal(r.headline, '아직 한 번도 검증을 못 돌렸습니다')
  assert.deepEqual([...r.facts], ['백테스트 0회', '1분봉 1,222개 (2026-09-27부터 4일치)', '신호 0건'])
  assert.match(r.next, /운영 화면/)
})

test('한 번이라도 돌았으면 아무 말도 안 한다 — 관문 여덟 줄이 스스로 말한다', () => {
  assert.equal(gateEmptyReason({ ...REAL, backtestRuns: 1 }), null)
  assert.equal(gateEmptyReason({ ...REAL, backtestRuns: 99 }), null)
})

test('조건은 건수이지 날짜가 아니다 — 며칠이 지나도 0회면 같은 말을 한다', () => {
  const later = gateEmptyReason({ ...REAL, bars: 99_999, firstBarDay: '2026-01-01', lastBarDay: '2026-12-31' })
  assert.ok(later)
  assert.equal(later.headline, '아직 한 번도 검증을 못 돌렸습니다')
})

test('봉이 0건이면 할 일이 다르다 — 기다리는 것이 아니라 수집을 봐야 한다', () => {
  const none = gateEmptyReason({ backtestRuns: 0, bars: 0, firstBarDay: null, lastBarDay: null, signals: 0, lastRunMessage: null })
  assert.ok(none)
  assert.equal(none.facts[1], '1분봉 0개')
  assert.match(none.next, /가격 봉이 먼저/)
})

test('검증이 한 말이 있으면 그것을 그대로 쓴다 — 필요한 날 수를 화면이 다시 셈하지 않는다', () => {
  // 실측 2026-09-30 검증이 실제로 준 문장
  const said = '거래일이 3일뿐입니다. 3겹 워크포워드에는 최소 81일이 필요합니다 (Lockbox 20 + 학습 30 + 띄움 1 + 검증 3×10)'
  const r = gateEmptyReason({ ...REAL, lastRunMessage: said })
  assert.equal(r?.next, said)
  // 봉이 0건이어도 검증이 한 말이 이긴다 — 그쪽이 더 정확하다
  const noBars = gateEmptyReason({ ...REAL, bars: 0, lastRunMessage: said })
  assert.equal(noBars?.next, said)
})

test('날짜를 모르면 며칠치인지 지어내지 않는다', () => {
  const r = gateEmptyReason({ ...REAL, firstBarDay: null })
  assert.equal(r?.facts[1], '1분봉 1,222개')
})
