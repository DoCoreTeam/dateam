import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moneyRows, positionRows, accountFailureView, ACCOUNT_VIEW_LABEL } from './account-view.ts'

test('예수금 다섯 줄을 만들고 못 받은 값은 0 으로 안 채운다', () => {
  const rows = moneyRows({
    cashKrw: 12_345_678,
    orderableCashKrw: null,
    additionalMarginKrw: 0,
    maintenanceRate: null,
    realizedPnlKrw: -50_000,
    evalPnlKrw: 120_000,
  })
  assert.equal(rows.length, 5)
  assert.equal(rows[0].name, ACCOUNT_VIEW_LABEL.cash)
  assert.equal(rows[0].won, 12_345_678)
  // 안 받은 값은 null 이다 — 0 으로 그리면 「주문 가능 현금이 0원」이 된다
  assert.equal(rows[1].won, null)
  assert.equal(rows[4].danger, true)
})

test('예수금을 아예 못 받았으면 줄을 안 만든다', () => {
  assert.deepEqual(moneyRows(null), [])
})

test('보유는 필요한 값만 옮기고 가린 계좌번호는 안 옮긴다', () => {
  const rows = positionRows([{
    contractCode: 'A05610',
    productName: '미니코스피200선물',
    direction: 'long',
    quantity: 2,
    avgPrice: 1084.22,
    evalPnlKrw: 30_000,
    liquidatableQty: 2,
    accountMasked: '****6745',
  }])
  assert.deepEqual(rows, [{
    contractCode: 'A05610',
    productName: '미니코스피200선물',
    direction: 'long',
    quantity: 2,
    avgPrice: 1084.22,
    evalPnlKrw: 30_000,
  }])
  assert.equal(JSON.stringify(rows).includes('6745'), false, '가린 계좌번호까지 화면으로 넘긴다')
})

test('실패는 우리 말로 적고 증권사 원문을 안 싣는다', () => {
  // 실측 2026-09-30 지금 상태
  const v = accountFailureView('kis:kis_APAC0071:fills')
  assert.equal(v.code, 'APAC0071')
  assert.equal(v.why, '증권사에 그 계좌번호가 없습니다')
  assert.match(v.how, /선물옵션 계좌번호/)
})

test('모르는 코드는 뜻을 지어내지 않는다', () => {
  const v = accountFailureView('kis:kis_ZZZZ9999:deposit')
  assert.equal(v.code, 'ZZZZ9999')
  assert.equal(v.why, '증권사에서 계좌를 못 읽었습니다')
  assert.match(v.how, /자격증명/)
})

test('코드가 아예 없어도 무엇을 하면 되는지는 말한다', () => {
  const v = accountFailureView('timeout')
  assert.equal(v.code, null)
  assert.ok(v.how.length > 0)
})
