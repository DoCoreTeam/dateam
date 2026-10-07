import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contractHeadline, NO_CONTRACT_TEXT, type ContractHead } from './overview-labels.ts'

/** 거래량도 증권사 기준 월물도 못 읽은 상태. 머리글은 종목 이름만 말한다 */
const unknownThickness = { todayVolume: null, exchangeFrontCode: null } as const

const head = (base: Omit<ContractHead, 'todayVolume' | 'exchangeFrontCode'>,
  extra: Partial<ContractHead> = {}): ContractHead => ({ ...base, ...unknownThickness, ...extra })

test('실측 종목을 사람 말로 부르고 기호는 괄호에 남긴다', () => {
  // 실측 2026-09-30: trading_contracts A05610 = MINI_KOSPI200, expiry_month 2026-10-01
  assert.equal(
    contractHeadline(head({ code: 'A05610', root: 'MINI_KOSPI200', expiryMonth: '2026-10-01' })),
    '미니 코스피200 선물 2026년 10월물 (A05610)',
  )
  assert.equal(
    contractHeadline(head({ code: 'K20012', root: 'KOSPI200', expiryMonth: '2026-12-01' })),
    '코스피200 선물 2026년 12월물 (K20012)',
  )
})

test('모르는 뿌리는 지어내지 않고 기호를 그대로 쓴다', () => {
  assert.equal(
    contractHeadline(head({ code: 'X9901', root: 'SOMETHING_NEW', expiryMonth: '2027-01-01' })),
    'SOMETHING_NEW 2027년 1월물 (X9901)',
  )
})

test('이름도 만기월도 모르면 기호만 말한다', () => {
  assert.equal(contractHeadline(head({ code: 'A05610', root: null, expiryMonth: null })), 'A05610')
  assert.equal(contractHeadline(head({ code: 'A05610', root: null, expiryMonth: 'broken' })), 'A05610')
})

test('종목이 없으면 없다고 말한다', () => {
  assert.equal(contractHeadline(null), NO_CONTRACT_TEXT)
})

test('머리글이 알림 이야기를 안 한다 — 그 말은 알림 칸 것이다', () => {
  const line = contractHeadline(head(
    { code: 'A05610', root: 'MINI_KOSPI200', expiryMonth: '2026-10-01' },
    { todayVolume: 112_701, exchangeFrontCode: 'A05611' },
  ))
  assert.equal(line.includes('알림'), false)
  assert.equal(line.includes('근월물'), false)
  assert.equal(line.includes('모으는 중'), false)
})


// ── 이 월물이 얼마나 거래되는가 ──────────────────────────

/**
 * 실측 2026-10-07. 화면이 11월물을 그리는 동안 거래는 10월물에 있었고,
 * 그날 거래량이 **10월물 112,701 대 11월물 5,036** 으로 22배 차이였다.
 * 머리글에는 월물 이름만 떠 있어서, 사용자가 자기 증권사 화면과 견주고서야
 * 「데이터가 잘못되었네」라고 물었다.
 */
test('★ 머리글이 오늘 이 월물에 붙은 거래량을 말한다', () => {
  const line = contractHeadline(head(
    { code: 'A05611', root: 'MINI_KOSPI200', expiryMonth: '2026-11-01' },
    { todayVolume: 5036 },
  ))
  assert.match(line, /미니 코스피200 선물 2026년 11월물 \(A05611\)/)
  assert.match(line, /5,036계약/, `거래량을 안 말한다: ${line}`)
})

test('★ 보는 월물이 증권사 기준과 다르면 그 사실을 말한다', () => {
  const line = contractHeadline(head(
    { code: 'A05611', root: 'MINI_KOSPI200', expiryMonth: '2026-11-01' },
    { todayVolume: 5036, exchangeFrontCode: 'A05610' },
  ))
  assert.match(line, /A05610/, `어느 월물이 기준인지 안 말한다: ${line}`)
  // 사용자 개입 2026-09-30 이 머리글에서 뺀 말이다. 다시 들이지 않는다
  assert.equal(line.includes('근월물'), false, line)
})

test('증권사 기준과 같으면 아무 말도 안 붙는다 — 평범한 날에 경고를 만들지 않는다', () => {
  const line = contractHeadline(head(
    { code: 'A05610', root: 'MINI_KOSPI200', expiryMonth: '2026-10-01' },
    { todayVolume: 112_701, exchangeFrontCode: 'A05610' },
  ))
  assert.equal(line, '미니 코스피200 선물 2026년 10월물 (A05610) · 오늘 112,701계약')
})

test('★ 거래량을 못 읽었으면 0 이라고 안 쓴다 — 못 읽은 것과 거래가 없는 것은 다른 사실이다', () => {
  const line = contractHeadline(head({ code: 'A05611', root: 'MINI_KOSPI200', expiryMonth: '2026-11-01' }))
  assert.equal(line, '미니 코스피200 선물 2026년 11월물 (A05611)')
  assert.equal(/계약/.test(line), false, `없는 숫자를 적는다: ${line}`)
})

test('거래가 한 계약도 없는 날은 0 이라고 말한다 — 0 은 사실이고 비움과 다르다', () => {
  const line = contractHeadline(head(
    { code: 'A05611', root: 'MINI_KOSPI200', expiryMonth: '2026-11-01' },
    { todayVolume: 0 },
  ))
  assert.match(line, /오늘 0계약/, line)
})
