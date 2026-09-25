/**
 * 청산 시각이 **고정값이 아니라는 것**을 잠근다
 *
 * 만기일에는 접속매매가 15:20 에 끝난다. 화면이나 코드에 15:20(평일 청산 시각)을
 * 적어 두면 만기일마다 15분 늦은 청산 시각을 말하게 되고, 그것은
 * **포지션이 남은 채 장이 끝나는 것**을 뜻한다. 미니는 만기가 매달이라 매달 그 날이 온다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRegularSession,
  isContinuousTrading,
  isAuctionWindow,
  sameDayExitAt,
  isNewEntryBlocked,
  isWeekendInSeoul,
  REGULAR_TIMES,
  EXPIRY_TIMES,
} from './session.ts'
import { dateRange } from './date-range.ts'

/** 서울 벽시계로 Date 하나 */
const seoul = (date: string, time: string) => new Date(`${date}T${time}:00+09:00`)

const DAY = '2026-09-25'      // 목요일, 평일
const EXPIRY = '2026-09-10'   // 2026년 9월 둘째 목요일

const weekday = buildRegularSession({ tradeDate: DAY, isExpiryDay: false })
const expiry = buildRegularSession({ tradeDate: EXPIRY, isExpiryDay: true })

test('평일 접속매매는 08:45 부터 15:35 까지다', () => {
  assert.equal(weekday.continuousStart.getTime(), seoul(DAY, '08:45').getTime())
  assert.equal(weekday.continuousEnd.getTime(), seoul(DAY, '15:35').getTime())
  assert.equal(weekday.openAuctionStart?.getTime(), seoul(DAY, '08:30').getTime())
  assert.equal(weekday.closeAuctionEnd?.getTime(), seoul(DAY, '15:45').getTime())
})

test('★ 단일가 구간은 판단 대상이 아니다 — 체결 방식이 다른 시장이다', () => {
  for (const time of ['08:30', '08:35', '08:44']) {
    assert.equal(isContinuousTrading(weekday, seoul(DAY, time)), false, `개장 전 단일가 ${time} 로 판단한다`)
    assert.equal(isAuctionWindow(weekday, seoul(DAY, time)), true, `${time} 를 단일가로 안 본다`)
  }
  for (const time of ['15:35', '15:40', '15:44']) {
    assert.equal(isContinuousTrading(weekday, seoul(DAY, time)), false, `장 마감 단일가 ${time} 로 판단한다`)
    assert.equal(isAuctionWindow(weekday, seoul(DAY, time)), true, `${time} 를 단일가로 안 본다`)
  }
})

test('경계는 시작 포함 끝 제외 — 하루에 봉이 하나 더 생기지 않게', () => {
  assert.equal(isContinuousTrading(weekday, seoul(DAY, '08:45')), true, '접속매매 첫 봉이 빠졌다')
  assert.equal(isContinuousTrading(weekday, seoul(DAY, '15:34')), true)
  assert.equal(isContinuousTrading(weekday, seoul(DAY, '15:35')), false, '단일가 첫 봉을 판단에 넣었다')
})

test('장외 시간은 접속매매도 단일가도 아니다', () => {
  for (const time of ['00:10', '07:00', '16:00', '23:59']) {
    assert.equal(isContinuousTrading(weekday, seoul(DAY, time)), false)
    assert.equal(isAuctionWindow(weekday, seoul(DAY, time)), false)
  }
})

test('★ 만기일은 접속매매가 15:20 에 끝나고 장 마감 단일가가 없다', () => {
  assert.equal(expiry.continuousEnd.getTime(), seoul(EXPIRY, '15:20').getTime())
  assert.equal(expiry.closeAuctionEnd, null, '확인 못 한 단일가를 있다고 가정했다')
  assert.equal(isContinuousTrading(expiry, seoul(EXPIRY, '15:25')), false)
})

test('★ 당일 청산은 고정 시각이 아니라 접속매매 종료 − N분이다', () => {
  // 평일 15:35 − 15분 = 15:20
  assert.equal(sameDayExitAt(weekday, 15).getTime(), seoul(DAY, '15:20').getTime())
  // 만기일 15:20 − 15분 = 15:05. 평일 값(15:20)을 그대로 쓰면 이미 장이 끝난 뒤다
  assert.equal(sameDayExitAt(expiry, 15).getTime(), seoul(EXPIRY, '15:05').getTime())
  // N 이 설정이라 바뀐다
  assert.equal(sameDayExitAt(weekday, 30).getTime(), seoul(DAY, '15:05').getTime())
})

test('★ 만기일 청산 시각이 평일 청산 시각보다 이르다 — 두 값이 같으면 규칙이 안 도는 것', () => {
  const weekdayExit = sameDayExitAt(weekday, 15)
  const expiryExit = sameDayExitAt(expiry, 15)
  const hhmm = (d: Date) => new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
  assert.equal(hhmm(weekdayExit), '15:20')
  assert.equal(hhmm(expiryExit), '15:05')
})

test('개장 직후·마감 전에는 새 신호를 안 낸다 (SR-04 시간 부분)', () => {
  const options = { openingMinutes: 5, closingMinutes: 30 }
  assert.equal(isNewEntryBlocked(weekday, seoul(DAY, '08:47'), options), true, '개장 2분 뒤인데 열렸다')
  assert.equal(isNewEntryBlocked(weekday, seoul(DAY, '08:50'), options), false)
  assert.equal(isNewEntryBlocked(weekday, seoul(DAY, '15:05'), options), true, '마감 30분 전인데 열렸다')
  assert.equal(isNewEntryBlocked(weekday, seoul(DAY, '15:04'), options), false)
  // 만기일은 같은 30분이 15:20 기준으로 당겨진다
  assert.equal(isNewEntryBlocked(expiry, seoul(EXPIRY, '14:51'), options), true)
})

test('거래소가 시간을 바꾼 날은 적힌 값이 기본값을 이긴다', () => {
  const special = buildRegularSession({
    tradeDate: DAY,
    isExpiryDay: false,
    override: { continuousStart: '10:00', continuousEnd: '16:00', openAuctionStart: '09:45' },
  })
  assert.equal(special.continuousStart.getTime(), seoul(DAY, '10:00').getTime())
  assert.equal(sameDayExitAt(special, 15).getTime(), seoul(DAY, '15:45').getTime())
})

test('접속매매 시각이 비면 조용히 넘어가지 않는다', () => {
  assert.throws(
    () => buildRegularSession({ tradeDate: DAY, isExpiryDay: false, override: { continuousEnd: null } }),
    /접속매매 시각이 비어 있습니다/,
  )
})

test('주말은 거래일이 아니다', () => {
  assert.equal(isWeekendInSeoul('2026-09-26'), true, '토요일')   // 토
  assert.equal(isWeekendInSeoul('2026-09-27'), true, '일요일')   // 일
  assert.equal(isWeekendInSeoul('2026-09-25'), false)
  assert.equal(isWeekendInSeoul('2026-09-28'), false)
})

test('기본 시각표가 명세 §6.3 과 같다', () => {
  assert.deepEqual({ ...REGULAR_TIMES }, {
    openAuctionStart: '08:30', continuousStart: '08:45', continuousEnd: '15:35', closeAuctionEnd: '15:45',
  })
  assert.deepEqual({ ...EXPIRY_TIMES }, {
    openAuctionStart: '08:30', continuousStart: '08:45', continuousEnd: '15:20', closeAuctionEnd: null,
  })
})

test('날짜 구간이 양끝을 포함하고 달을 넘어간다', () => {
  assert.deepEqual(dateRange('2026-09-29', '2026-10-02'),
    ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])
  assert.deepEqual(dateRange('2026-09-29', '2026-09-29'), ['2026-09-29'])
  assert.deepEqual(dateRange('2026-09-29', '2026-09-28'), [])
})
