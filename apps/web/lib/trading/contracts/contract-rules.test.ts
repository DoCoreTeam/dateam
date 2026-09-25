/**
 * 월물을 틀리면 **오류가 아니라 빈 응답**이 온다
 *
 * 없는 코드로 조회하면 KIS 는 화내지 않고 아무것도 안 준다. 화면에는
 * 「시장이 조용하다」로 보이고, 그 상태로 하루가 지나면 그날 데이터가 통째로 없다.
 * 그래서 코드를 지어내지 않고 마스터가 말한 것만 쓴다.
 *
 * 아래 줄들은 2026-09-26 실제 마스터에서 그대로 가져온 것이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseIndexFutureMaster,
  contractsOf,
  frontContractOf,
  nextContractOf,
  expiryMonthOf,
  secondThursday,
  lastTradingDay,
  expiryMonthsOf,
  shouldRollover,
} from './contract-rules.ts'

/** 실제 마스터에서 그대로 옮긴 줄들 (2026-09-26 실측) */
const MASTER = [
  '1|A01612|KR4A016C0004|F 202612| |00000.00|1|2001|KOSPI200',
  '1|A01703|KR4A01730006|F 202703| |00000.00|2|2001|KOSPI200',
  '1|A01706|KR4A01760003|F 202706| |00000.00|3|2001|KOSPI200',
  '1|A01709|KR4A01790000|F 202709| |00000.00|4|2001|KOSPI200',
  'B|A05610|KR4A056A0007|미니F 202610| |00000.00|1|2001|KOSPI200',
  'B|A05611|KR4A056B0006|미니F 202611| |00000.00|2|2001|KOSPI200',
  'B|A05612|KR4A056C0005|미니F 202612| |00000.00|3|2001|KOSPI200',
  // 옵션. 기초자산이 같아도 선물이 아니라 봉의 뜻이 다르다
  '5|B01610A03|KR4B016AA032|C 202610 1,010.0|2|01010.00| |2001|KOSPI200',
  // 코스닥150. 기초자산이 다르다
  '3|A03610|KR4A036A0000|스타F 202610| |00000.00|1|2002|KSQ150',
].join('\n')

test('★ 마스터에서 정규 근월물을 그대로 읽는다 — 코드를 지어내지 않는다', () => {
  const { rows, dropped } = parseIndexFutureMaster(MASTER)
  assert.equal(dropped, 0)
  const regular = contractsOf(rows, 'KOSPI200')
  assert.deepEqual(regular.map((c) => c.code), ['A01612', 'A01703', 'A01706', 'A01709'])
  assert.equal(frontContractOf(regular)?.code, 'A01612')
  assert.equal(frontContractOf(regular)?.expiryMonth, '2026-12-01')
  assert.equal(nextContractOf(regular)?.code, 'A01703')
})

test('★ 미니는 매월물이고 근월물이 따로다', () => {
  const { rows } = parseIndexFutureMaster(MASTER)
  const mini = contractsOf(rows, 'MINI_KOSPI200')
  assert.deepEqual(mini.map((c) => c.code), ['A05610', 'A05611', 'A05612'])
  assert.equal(frontContractOf(mini)?.code, 'A05610', '미니 근월물이 정규와 같은 달로 잡혔다')
  assert.equal(frontContractOf(mini)?.expiryMonth, '2026-10-01')
})

test('옵션과 다른 기초자산은 섞이지 않는다', () => {
  const { rows } = parseIndexFutureMaster(MASTER)
  const all = [...contractsOf(rows, 'KOSPI200'), ...contractsOf(rows, 'MINI_KOSPI200')]
  assert.equal(all.some((c) => c.code.startsWith('B01')), false, '옵션이 선물 목록에 들어왔다')
  assert.equal(all.some((c) => c.code === 'A03610'), false, '코스닥150 이 들어왔다')
})

test('연결선물(월물구분 0)은 조회 대상이 아니다', () => {
  const { rows } = parseIndexFutureMaster('1|A01000|KR4A010000000|F 연결| |00000.00|0|2001|KOSPI200')
  assert.deepEqual(contractsOf(rows, 'KOSPI200'), [])
})

test('칸 수가 다른 줄은 조용히 빠지지 않고 세어진다', () => {
  const { rows, dropped } = parseIndexFutureMaster('1|A01612|짧은줄\n' + MASTER)
  assert.equal(dropped, 1, '형식이 바뀐 날 월물이 0개가 되고 아무도 모른다')
  assert.equal(rows.length, 9)
})

test('한글종목명에서 만기 달을 읽는다', () => {
  assert.equal(expiryMonthOf('F 202612'), '2026-12-01')
  assert.equal(expiryMonthOf('미니F 202610'), '2026-10-01')
  assert.equal(expiryMonthOf('F 연결'), null)
  assert.equal(expiryMonthOf('F 202613'), null, '13월을 받아들였다')
})

test('★ 근월물은 순서가 아니라 마스터가 말한 것이다', () => {
  // 일부러 이른 달을 차근월물(2)로, 늦은 달을 최근월물(1)로 적었다.
  // 순서로 고르면 첫 줄(A01703)이 나오고, 마스터를 믿으면 A01706 이 나온다.
  // 만기 직후처럼 거래소가 월물 상태를 먼저 바꾸는 날이 실제로 이 모양이 된다
  const { rows } = parseIndexFutureMaster([
    '1|A01703|KR4A01730006|F 202703| |00000.00|2|2001|KOSPI200',
    '1|A01706|KR4A01760003|F 202706| |00000.00|1|2001|KOSPI200',
  ].join('\n'))
  const contracts = contractsOf(rows, 'KOSPI200')
  assert.equal(contracts[0].code, 'A01703', '정렬은 만기 순이다')
  assert.equal(frontContractOf(contracts)?.code, 'A01706', '순서로 근월물을 골랐다')
})

test('근월물이 없으면 첫 줄로 때우지 않는다', () => {
  const { rows } = parseIndexFutureMaster('1|A01703|KR4A01730006|F 202703| |00000.00|2|2001|KOSPI200')
  assert.equal(frontContractOf(contractsOf(rows, 'KOSPI200')), null)
})

// ── 최종거래일 ───────────────────────────────────────────

test('★ 2026년 열두 달의 둘째 목요일이 맞다', () => {
  const expected = [
    '2026-01-08', '2026-02-12', '2026-03-12', '2026-04-09',
    '2026-05-14', '2026-06-11', '2026-07-09', '2026-08-13',
    '2026-09-10', '2026-10-08', '2026-11-12', '2026-12-10',
  ]
  for (let month = 1; month <= 12; month += 1) {
    const day = secondThursday(2026, month)
    assert.equal(day, expected[month - 1], `${month}월`)
    // 실제로 목요일인가 — 표를 옮겨 적다 틀려도 여기서 걸린다
    assert.equal(new Date(`${day}T12:00:00+09:00`).getUTCDay(), 4, `${day} 가 목요일이 아니다`)
  }
})

test('★ 둘째 목요일이 휴장일이면 앞당긴다 — 뒤로 미루면 만기 지난 월물로 하루 더 판단한다', () => {
  // 2026-09-10 이 휴장이면 전날(수)로
  assert.equal(lastTradingDay(2026, 9, new Set(['2026-09-10'])), '2026-09-09')
  // 연속 휴장이면 계속 앞으로
  assert.equal(lastTradingDay(2026, 9, new Set(['2026-09-10', '2026-09-09'])), '2026-09-08')
  // 주말까지 걸치면 금요일로 건너뛴다
  assert.equal(
    lastTradingDay(2026, 9, new Set(['2026-09-10', '2026-09-09', '2026-09-08', '2026-09-07'])),
    '2026-09-04',
  )
  assert.equal(lastTradingDay(2026, 9), '2026-09-10', '휴장일이 없으면 둘째 목요일 그대로')
})

test('정규는 분기물, 미니는 매월물이다', () => {
  assert.deepEqual(expiryMonthsOf('KOSPI200'), [3, 6, 9, 12])
  assert.equal(expiryMonthsOf('MINI_KOSPI200').length, 12)
})

// ── 교체 ─────────────────────────────────────────────────

test('차근월물 거래량이 근월물을 넘으면 그날 갈아탄다', () => {
  const decision = shouldRollover({ frontVolume: 100, nextVolume: 101, tradingDaysUntilLast: 10, daysBefore: 3 })
  assert.deepEqual(decision, { roll: true, reason: 'next_volume_exceeded' })
})

test('★ 거래량이 안 뒤집혀도 기한이 오면 갈아탄다 — 없으면 만기일까지 마른 월물로 판단한다', () => {
  const decision = shouldRollover({ frontVolume: 1000, nextVolume: 1, tradingDaysUntilLast: 3, daysBefore: 3 })
  assert.deepEqual(decision, { roll: true, reason: 'deadline_reached' })
})

test('아직 근월물이 무겁고 기한도 멀면 안 갈아탄다', () => {
  const decision = shouldRollover({ frontVolume: 1000, nextVolume: 999, tradingDaysUntilLast: 4, daysBefore: 3 })
  assert.deepEqual(decision, { roll: false, reason: 'front_still_heavier' })
})

test('거래량이 같으면 안 넘은 것이다 — 같은 날 앞뒤로 흔들리며 왔다 갔다 하지 않게', () => {
  const decision = shouldRollover({ frontVolume: 500, nextVolume: 500, tradingDaysUntilLast: 9, daysBefore: 3 })
  assert.equal(decision.roll, false)
})
