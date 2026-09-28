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
  isContinuousTrading, NIGHT_TIMES, hasNightSession,
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

// ── 장이 안 서는 저녁에는 야간 줄을 안 만든다 (P0086 I01) ─────────────

test('★ 토·일 저녁에는 야간장이 안 선다', () => {
  /*
    실측 2026-09-29: `trading_session_calendar` 에 trade_date 2026-09-27 night 줄이 있었다.
    그것은 토요일 저녁(9/26 18:00)에 만든 줄이고 그런 장은 없다.
    `ensureSessionWindow` 는 주말을 보는데 `ensureNightWindow` 만 안 봐서 생긴 줄이다.
  */
  assert.equal(hasNightSession('2026-09-26'), false, '토요일 저녁')
  assert.equal(hasNightSession('2026-09-27'), false, '일요일 저녁')
  assert.equal(hasNightSession('2026-09-25'), true, '금요일 저녁 — 이건 선다')
  assert.equal(hasNightSession('2026-09-28'), true, '월요일 저녁')
})

test('★ 금요일 밤 장은 토요일이 아니라 다음 거래일 몫이다', () => {
  /*
    달력 하루를 더하면 금요일 밤이 토요일 몫이 된다. 토요일에는 장이 안 서므로
    손익이 장이 없는 날에 잡히고 일일 한도가 아무도 안 쓰는 날에 소진된다(§6.4).
  */
  assert.equal(nightTradeDate('2026-09-25', 'next'), '2026-09-28', '금요일 밤 → 월요일')
  assert.equal(nightTradeDate('2026-09-28', 'next'), '2026-09-29', '월요일 밤 → 화요일')
  // 'same' 규칙은 시작한 날 그대로다 — 거래일로 안 민다
  assert.equal(nightTradeDate('2026-09-25', 'same'), '2026-09-25')
})

test('★ 끝나는 시각은 달력 하루 뒤다 — 귀속 거래일과 다르다', () => {
  const fri = buildNightSession('2026-09-25', 'next')
  assert.equal(fri.tradeDate, '2026-09-28', '귀속은 월요일')
  // 장은 토요일 새벽에 끝난다. 여기까지 거래일로 밀면 주말 내내 열린 것으로 잡힌다
  const endKst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(fri.continuousEnd)
  assert.equal(endKst, '2026-09-26', '끝은 토요일 새벽')
  assert.ok(fri.continuousEnd.getTime() - fri.continuousStart.getTime() <= 13 * 60 * 60_000,
    '한 밤보다 긴 야간장이 만들어진다')
})

test('★ 씨 뿌리는 자리가 그 검사를 실제로 지난다', () => {
  const src = readFileSync(join(HERE, 'seed.ts'), 'utf8')
  assert.ok(src.includes('hasNightSession('),
    'ensureNightWindow 가 주말을 안 본다 — 토요일마다 없는 장이 생긴다')
  assert.ok(src.includes('no_night:weekend_evening'),
    '안 만들었다는 사실을 실행 사유에 안 남긴다')
})
