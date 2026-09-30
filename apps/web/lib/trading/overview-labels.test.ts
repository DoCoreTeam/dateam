import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contractHeadline, NO_CONTRACT_TEXT } from './overview-labels.ts'

test('실측 종목을 사람 말로 부르고 기호는 괄호에 남긴다', () => {
  // 실측 2026-09-30: trading_contracts A05610 = MINI_KOSPI200, expiry_month 2026-10-01
  assert.equal(
    contractHeadline({ code: 'A05610', root: 'MINI_KOSPI200', expiryMonth: '2026-10-01' }),
    '미니 코스피200 선물 2026년 10월물 (A05610)',
  )
  assert.equal(
    contractHeadline({ code: 'K20012', root: 'KOSPI200', expiryMonth: '2026-12-01' }),
    '코스피200 선물 2026년 12월물 (K20012)',
  )
})

test('모르는 뿌리는 지어내지 않고 기호를 그대로 쓴다', () => {
  assert.equal(
    contractHeadline({ code: 'X9901', root: 'SOMETHING_NEW', expiryMonth: '2027-01-01' }),
    'SOMETHING_NEW 2027년 1월물 (X9901)',
  )
})

test('이름도 만기월도 모르면 기호만 말한다', () => {
  assert.equal(contractHeadline({ code: 'A05610', root: null, expiryMonth: null }), 'A05610')
  assert.equal(contractHeadline({ code: 'A05610', root: null, expiryMonth: 'broken' }), 'A05610')
})

test('종목이 없으면 없다고 말한다', () => {
  assert.equal(contractHeadline(null), NO_CONTRACT_TEXT)
})

test('머리글이 알림 이야기를 안 한다 — 그 말은 알림 칸 것이다', () => {
  const line = contractHeadline({ code: 'A05610', root: 'MINI_KOSPI200', expiryMonth: '2026-10-01' })
  assert.equal(line.includes('알림'), false)
  assert.equal(line.includes('근월물'), false)
  assert.equal(line.includes('모으는 중'), false)
})
