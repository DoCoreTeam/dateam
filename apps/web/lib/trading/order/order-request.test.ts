/**
 * 주문 만들기 — **방향이 부호를 정하고, 수량은 늘 1이다**
 *
 * 매수·매도 코드가 뒤집히면 반대로 주문한다. 그리고 화면에서는 아무 일도 안 일어난 것처럼
 * 보인다 — 체결이 돌아와야 안다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ORDER_PATHS, ORDER_TR, SLL_BUY, NMPR_TYPE, FIXED_QUANTITY,
  orderTrId, buildPlaceOrder, buildCancelOrder, orderUrl, orderHeaders,
  describeOrder, readOrderNo,
} from './order-request.ts'
import { KIS_HOST_REAL, KIS_HOST_PAPER } from '../broker/endpoints.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ACCT = { cano: '50123456', acntPrdtCd: '03' }
const AUTH = { accessToken: 'tok', appKey: 'ak', appSecret: 'as' }

test('★ 2026-09-26 공식 예제에서 읽은 주문 TR 그대로다', () => {
  assert.equal(ORDER_TR.place.realDay, 'TTTO1101U')
  assert.equal(ORDER_TR.place.realNight, 'STTN1101U')
  assert.equal(ORDER_TR.place.paperDay, 'VTTO1101U')
  assert.equal(ORDER_TR.reviseCancel.realDay, 'TTTO1103U')
  assert.equal(ORDER_TR.reviseCancel.realNight, 'TTTN1103U')
  assert.equal(ORDER_TR.reviseCancel.paperDay, 'VTTO1103U')
})

test('★ 주문 TR 은 전부 끝이 U 다 — 끝 글자가 조회와 주문을 가른다', () => {
  for (const api of ['place', 'reviseCancel'] as const) {
    for (const v of Object.values(ORDER_TR[api])) {
      if (v === null) continue
      assert.match(v, /^[A-Z]{4}\d{4}U$/, `${v} 가 주문꼴이 아니다`)
    }
  }
})

test('★ 모의 야간은 실전으로 대신 안 부른다', () => {
  assert.deepEqual(orderTrId('place', 'paper', 'night'), { ok: false, reason: 'paper_night_unsupported' })
  assert.deepEqual(orderTrId('place', 'paper', 'day'), { ok: true, trId: 'VTTO1101U' })
  assert.deepEqual(orderTrId('place', 'real', 'night'), { ok: true, trId: 'STTN1101U' })
})

test('★ 매수·매도 코드가 뒤집히지 않는다 — 뒤집히면 반대로 주문한다', () => {
  // 공식 예제: 01 매도, 02 매수
  assert.equal(SLL_BUY.short, '01')
  assert.equal(SLL_BUY.long, '02')
  assert.notEqual(SLL_BUY.long, SLL_BUY.short)
  const buy = buildPlaceOrder({ acct: ACCT, contractCode: '101W12', direction: 'long', quantity: 1, unitPrice: 0, priceType: 'market' })
  assert.ok(buy.ok)
  assert.equal(buy.body.SLL_BUY_DVSN_CD, '02')
  const sell = buildPlaceOrder({ acct: ACCT, contractCode: '101W12', direction: 'short', quantity: 1, unitPrice: 0, priceType: 'market' })
  assert.ok(sell.ok)
  assert.equal(sell.body.SLL_BUY_DVSN_CD, '01')
})

test('★ 수량이 1 이 아니면 안 만든다 (D-11)', () => {
  assert.equal(FIXED_QUANTITY, 1)
  for (const q of [0, 2, 10, -1]) {
    const r = buildPlaceOrder({ acct: ACCT, contractCode: '101W12', direction: 'long', quantity: q, unitPrice: 0, priceType: 'market' })
    assert.equal(r.ok, false, `수량 ${q} 로 주문을 만들었다`)
    assert.match(r.ok === false ? r.reason : '', /^quantity_not_one/)
  }
  // 만든 본문도 늘 1
  const ok = buildPlaceOrder({ acct: ACCT, contractCode: '101W12', direction: 'long', quantity: 1, unitPrice: 0, priceType: 'market' })
  assert.ok(ok.ok)
  assert.equal(ok.body.ORD_QTY, '1')
})

test('시장가는 가격 0, 지정가는 0 이면 거부', () => {
  const market = buildPlaceOrder({ acct: ACCT, contractCode: 'x', direction: 'long', quantity: 1, unitPrice: 999, priceType: 'market' })
  assert.ok(market.ok)
  assert.equal(market.body.UNIT_PRICE, '0', '시장가인데 가격을 실었다')
  assert.equal(market.body.NMPR_TYPE_CD, NMPR_TYPE.market)

  const limit = buildPlaceOrder({ acct: ACCT, contractCode: 'x', direction: 'long', quantity: 1, unitPrice: 301.5, priceType: 'limit' })
  assert.ok(limit.ok)
  assert.equal(limit.body.UNIT_PRICE, '301.5')
  assert.equal(buildPlaceOrder({ acct: ACCT, contractCode: 'x', direction: 'long', quantity: 1, unitPrice: 0, priceType: 'limit' }).ok, false)
})

test('빈 종목은 주문하지 않는다', () => {
  assert.equal(buildPlaceOrder({ acct: ACCT, contractCode: '  ', direction: 'long', quantity: 1, unitPrice: 0, priceType: 'market' }).ok, false)
})

test('취소는 전량이다 — 1계약이라 부분이 없다', () => {
  const r = buildCancelOrder({ acct: ACCT, originalOrderNo: '0000117057' })
  assert.ok(r.ok)
  assert.equal(r.body.RVSE_CNCL_DVSN_CD, '02')
  assert.equal(r.body.ORD_QTY, '0', '0 이 전량이다')
  assert.equal(r.body.RMN_QTY_YN, 'Y')
  assert.equal(buildCancelOrder({ acct: ACCT, originalOrderNo: ' ' }).ok, false)
})

// ── 보안 ────────────────────────────────────────────────

test('★ 주소의 호스트와 경로에 바깥 값이 안 섞인다 (S4)', () => {
  assert.equal(orderUrl('real', 'place'), `${KIS_HOST_REAL}${ORDER_PATHS.place}`)
  assert.equal(orderUrl('paper', 'reviseCancel'), `${KIS_HOST_PAPER}${ORDER_PATHS.reviseCancel}`)
  // 경로는 둘뿐이다
  assert.deepEqual(Object.keys(ORDER_PATHS).sort(), ['place', 'reviseCancel'])
})

test('요청 머리에 주문 TR 이 들어간다', () => {
  const h = orderHeaders(AUTH, 'TTTO1101U')
  assert.equal(h.tr_id, 'TTTO1101U')
  assert.equal(h.custtype, 'P')
})

test('★ 사람이 볼 한 줄에 계좌번호가 안 나온다 (S3)', () => {
  const r = buildPlaceOrder({ acct: ACCT, contractCode: '101W12', direction: 'long', quantity: 1, unitPrice: 0, priceType: 'market' })
  assert.ok(r.ok)
  const line = describeOrder(r.body)
  assert.equal(line.includes('50123456'), false, '계좌번호가 그대로 나왔다')
  assert.ok(line.includes('5012****'))
  assert.ok(line.includes('매수'))
})

test('주문번호를 읽는다. 없으면 나갔는지 모른다', () => {
  assert.equal(readOrderNo({ ODNO: '0000117057' }), '0000117057')
  assert.equal(readOrderNo({ odno: '123' }), '123')
  for (const bad of [null, {}, { ODNO: '' }, { ODNO: 1 }, 'text']) {
    assert.equal(readOrderNo(bad), null, `${JSON.stringify(bad)} 에서 번호를 만들었다`)
  }
})

// ── M1' 경계 ────────────────────────────────────────────

test('★ 주문 코드가 order 폴더 안에 있다 — 경계를 옮겼지 버린 것이 아니다', () => {
  const dir = HERE.replace(/\\/g, '/')
  assert.ok(dir.endsWith('/lib/trading/order'), `주문 코드가 ${dir} 에 있다`)
})

test('★ 이 모듈이 실제로 부르지는 않는다 — 만들기와 보내기가 나뉘어 있다', () => {
  const src = readFileSync(join(HERE, 'order-request.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  assert.equal(/fetch\s*\(/.test(src), false,
    '만드는 자리가 보낸다 — 나눠 둬야 「만들었지만 안 보냈다」를 시험할 수 있다')
  assert.equal(src.includes("import 'server-only'"), false, 'server-only 라 시험이 못 읽는다')
})
