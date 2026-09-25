/**
 * 야간장 — **모으되 판단하지 않는다** (명세 §6.1)
 *
 * 야간장은 자정을 넘는다. 그 하나가 정규장과 다른 전부이고, 놓치면 자정 이후 봉이
 * 통째로 「장외」로 밀려 그 시간대가 영영 안 쌓인다.
 *
 * 그리고 귀속 거래일이 틀리면 밤에 난 결과가 어제 몫으로 잡힌다 —
 * 손익과 일일 한도가 거래일 기준이라(§6.4) 한도가 이미 닫힌 날에 거래한 것처럼 보인다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildNightSession, nightTradeDate, isNightHour, nightStartDateOf,
  isContinuousTrading, NIGHT_TIMES,
} from './session.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 서울 벽시계 */
const seoul = (date: string, time: string) => new Date(`${date}T${time}:00+09:00`)

test('야간장은 18:00 에 시작해 다음 날 06:00 에 끝난다', () => {
  const night = buildNightSession('2026-09-24', 'next')
  assert.equal(night.continuousStart.getTime(), seoul('2026-09-24', '18:00').getTime())
  assert.equal(night.continuousEnd.getTime(), seoul('2026-09-25', '06:00').getTime())
  assert.equal(night.session, 'night')
  assert.equal(night.openAuctionStart, null, '야간장에 없는 단일가를 있다고 적었다')
  assert.equal(night.closeAuctionEnd, null)
  assert.deepEqual({ ...NIGHT_TIMES }, { start: '18:00', end: '06:00' })
})

test('★ 자정을 넘는다 — 새벽 02:00 이 그 장 안이다', () => {
  const night = buildNightSession('2026-09-24', 'next')
  for (const [date, time] of [['2026-09-24', '18:00'], ['2026-09-24', '23:59'], ['2026-09-25', '02:00'], ['2026-09-25', '05:59']] as const) {
    assert.equal(isContinuousTrading(night, seoul(date, time)), true, `${date} ${time} 가 장 밖으로 잡혔다`)
  }
  assert.equal(isContinuousTrading(night, seoul('2026-09-24', '17:59')), false)
  assert.equal(isContinuousTrading(night, seoul('2026-09-25', '06:00')), false, '끝은 제외다')
})

test('★ 저녁에 시작한 장은 다음 거래일 몫이다 — 틀리면 어제 한도로 오늘을 잰다', () => {
  assert.equal(nightTradeDate('2026-09-24', 'next'), '2026-09-25')
  assert.equal(nightTradeDate('2026-09-24', 'same'), '2026-09-24')
  // 월말을 넘어도 맞는다
  assert.equal(nightTradeDate('2026-09-30', 'next'), '2026-10-01')
  assert.equal(nightTradeDate('2026-12-31', 'next'), '2027-01-01')

  const night = buildNightSession('2026-09-24', 'next')
  assert.equal(night.tradeDate, '2026-09-25', '창은 24일 저녁인데 거래일은 25일이다')
})

test('야간 시간대 판정이 자정을 제대로 감싼다', () => {
  for (const [date, time] of [['2026-09-24', '18:00'], ['2026-09-24', '23:00'], ['2026-09-25', '00:30'], ['2026-09-25', '05:59']] as const) {
    assert.equal(isNightHour(seoul(date, time)), true, `${time} 가 야간이 아니라고 나왔다`)
  }
  for (const time of ['06:00', '09:00', '15:00', '17:59']) {
    assert.equal(isNightHour(seoul('2026-09-24', time)), false, `${time} 가 야간으로 잡혔다`)
  }
})

test('★ 새벽이면 전날 저녁에 시작한 장이다', () => {
  assert.equal(nightStartDateOf(seoul('2026-09-25', '02:00')), '2026-09-24')
  assert.equal(nightStartDateOf(seoul('2026-09-25', '05:59')), '2026-09-24')
  assert.equal(nightStartDateOf(seoul('2026-09-24', '18:00')), '2026-09-24')
  assert.equal(nightStartDateOf(seoul('2026-09-24', '23:30')), '2026-09-24')
  // 달을 넘어도 맞는다
  assert.equal(nightStartDateOf(seoul('2026-10-01', '01:00')), '2026-09-30')
})

// ── 배선 ─────────────────────────────────────────────────

test('★ 크론이 야간 창을 실제로 세우고 그 시간대에 모은다', () => {
  const tick = readFileSync(join(HERE, '..', 'jobs', 'tick.ts'), 'utf8')
  assert.match(tick, /ensureNightWindow\(/, '야간 창을 안 세운다 — 야간 봉이 영영 안 쌓인다')
  assert.match(tick, /isNightHour\(/, '지금이 야간인지를 안 묻는다')
  assert.match(tick, /nightStartDateOf\(/, '새벽에 전날 저녁 장을 못 찾는다')
})

test('★ 야간 봉으로는 판단하지 않는다 — 명세가 「신호는 정규장만」이라고 적는다', () => {
  const tick = readFileSync(join(HERE, '..', 'jobs', 'tick.ts'), 'utf8')
  const body = tick.replace(/\/\*[\s\S]*?\*\//g, ' ')

  const nightReturn = body.indexOf('night_collected')
  const judgeCall = body.indexOf('runJudges(')
  assert.ok(nightReturn > 0, '야간 수집 뒤 되돌아가는 길이 없다')
  assert.ok(judgeCall > nightReturn, '야간에도 판단기까지 내려간다 — 다른 장을 보고 판단하는 것이다')
})

test('★ 야간도 새 창구를 안 연다 — 같은 크론 라우트를 쓴다', () => {
  const api = join(HERE, '..', '..', '..', 'app', 'api', 'trading')
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])
  const routes = walk(api).filter((f) => f.endsWith('route.ts'))
  /**
   * 야간 전용 창구가 없어야 한다. 창구 수 자체는 다른 일(검증)로도 늘 수 있으므로
   * **개수가 아니라 이름**을 본다 — 개수로 세면 남의 항목이 창구를 열 때마다 이 시험이 깨진다.
   */
  const nightRoutes = routes.filter((f) => /night/i.test(f))
  assert.deepEqual(nightRoutes, [], '야간 전용 창구가 생겼다. 같은 크론이 처리한다')
  assert.ok(routes.some((f) => f.includes('tick')), '수집 창구가 없다')
})
