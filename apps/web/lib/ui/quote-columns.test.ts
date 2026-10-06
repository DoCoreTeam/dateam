// lib/ui/quote-columns.test.ts — 열 폭의 **합이 100 인지**를 기계가 센다
//
// 비율 합이 틀리면 브라우저가 남는 폭을 제 마음대로 나눠, 화면과 종이의 배치가 갈린다.
// 경우가 여덟이라(할인 × 비고 × 긴 비고) 사람이 암산하면 언젠가 틀린다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  quoteColumnWidths, hasLongRemark, pct, REMARK_LONG_CHARS,
} from './quote-columns.ts'

const CASES = [false, true]

test('★ 어느 경우든 열 폭의 합은 100 이다', () => {
  for (const showDiscount of CASES) {
    for (const showRemark of CASES) {
      for (const longRemark of CASES) {
        const w = quoteColumnWidths({ showDiscount, showRemark, longRemark })
        const sum = w.no + w.name + w.unit + w.quantity + w.unitPrice + w.discount
          + w.amount + w.remark
        assert.equal(sum, 100,
          `합이 ${sum} 이다 (할인=${showDiscount} 비고=${showRemark} 긴비고=${longRemark})`)
      }
    }
  }
})

test('★ 안 서는 열은 폭이 0 이다', () => {
  const w = quoteColumnWidths({ showDiscount: false, showRemark: false })
  assert.equal(w.discount, 0)
  assert.equal(w.remark, 0)
})

test('★ 금액과 할인은 안 줄어든다 — 실측으로 정한 값이다', () => {
  for (const longRemark of CASES) {
    const w = quoteColumnWidths({ showDiscount: true, showRemark: true, longRemark })
    assert.equal(w.amount, 25, '금액 열이 줄었다 — 「330,000,000원」의 「원」이 잘린다')
    assert.equal(w.discount, 16, '할인 열이 줄었다 — 「30% → 100%」가 접힌다')
  }
})

test('★ 비고가 길면 비고 열이 넓어지고 단가에서 떼어 온다', () => {
  const short = quoteColumnWidths({ showDiscount: true, showRemark: true, longRemark: false })
  const long = quoteColumnWidths({ showDiscount: true, showRemark: true, longRemark: true })
  assert.equal(short.remark, 10)
  assert.equal(long.remark, 15, '긴 비고인데 폭이 그대로다')
  assert.equal(short.unitPrice, 15)
  assert.equal(long.unitPrice, 12, '단가에서 안 떼어 왔다')
  assert.equal(short.name - long.name, 2, '이름에서 2 보다 많이 떼어 갔다')
})

test('★ 비고 열이 안 서면 긴 비고 여부는 폭을 안 바꾼다', () => {
  const a = quoteColumnWidths({ showDiscount: true, showRemark: false, longRemark: true })
  const b = quoteColumnWidths({ showDiscount: true, showRemark: false, longRemark: false })
  assert.deepEqual(a, b, '비고가 없는데 폭이 달라졌다')
})

test('★ 긴 비고는 글자 수로 센다 — 빈칸만 적은 것은 안 센다', () => {
  assert.equal(hasLongRemark([{ remark: '64코어' }]), false)
  assert.equal(hasLongRemark([{ remark: null }, { remark: undefined }, {}]), false)
  assert.equal(hasLongRemark([{ remark: ' '.repeat(80) }]), false, '빈칸을 글로 셌다')
  assert.equal(hasLongRemark([{ remark: 'a'.repeat(REMARK_LONG_CHARS) }]), false, '경계를 넘겼다')
  assert.equal(hasLongRemark([{ remark: 'a'.repeat(REMARK_LONG_CHARS + 1) }]), true)
  // 한 줄만 길어도 그 열은 넓어져야 한다
  assert.equal(hasLongRemark([
    { remark: '64코어' },
    { remark: 'providing the special discount for this two months rent.' },
  ]), true)
})

test('★ 퍼센트 글자는 그대로 붙인다', () => {
  assert.equal(pct(25), '25%')
  assert.equal(pct(0), '0%')
})
