// lib/ui/quote-columns.test.ts — 열 폭의 **합이 100 인지**를 기계가 센다
//
// 비율 합이 틀리면 브라우저가 남는 폭을 제 마음대로 나눠, 화면과 종이의 배치가 갈린다.
// 경우가 여덟이라(할인 × 비고 × 긴 비고) 사람이 암산하면 언젠가 틀린다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  quoteColumnWidths, hasLongRemark, pct, REMARK_LONG_CHARS, BASIS_PX, type QuoteColumnContent,
} from './quote-columns.ts'

const CASES = [false, true]

/** 실측 견적(2026-10-20)에 든 글자. 특별 할인 화살표가 없다 */
const PLAIN: QuoteColumnContent = {
  unitPrice: ['13,000,000원', '2,000,000원', '0원'],
  discount: ['70%', '30%', '100%', ''],
  discountTag: [],
  amount: ['3,900,000원', '16,800,000원', '0원', '20,700,000원'],
  grand: ['20,000,000원'],
}

/** 가장 넓은 경우. 큰 합계, 화살표, 특별 할인 표시 */
const WIDE: QuoteColumnContent = {
  unitPrice: ['330,000,000원'],
  discount: ['30% → 100%'],
  discountTag: ['특별 할인'],
  amount: ['330,000,000원'],
  grand: ['330,000,000원'],
}

/** 실측 폭(2026-10-20, 표 728px) — 이 글자들이 차지하는 px 과 칸 여백 24px */
const usable = (p: number) => (p / 100) * BASIS_PX - 24

test('★ 어느 경우든 열 폭의 합은 100 이다', () => {
  for (const showDiscount of CASES) {
    for (const showRemark of CASES) {
      for (const longRemark of CASES) {
        for (const content of [PLAIN, WIDE]) {
        const w = quoteColumnWidths({ showDiscount, showRemark, longRemark, content })
        const sum = w.no + w.name + w.unit + w.quantity + w.unitPrice + w.discount
          + w.amount + w.remark
        assert.equal(sum, 100,
          `합이 ${sum} 이다 (할인=${showDiscount} 비고=${showRemark} 긴비고=${longRemark})`)
        }
      }
    }
  }
})

test('★ 안 서는 열은 폭이 0 이다', () => {
  const w = quoteColumnWidths({ showDiscount: false, showRemark: false, content: PLAIN })
  assert.equal(w.discount, 0)
  assert.equal(w.remark, 0)
})

test('★ 숫자 칸은 실측 글자가 들어갈 만큼 된다 — 「원」이 잘리거나 화살표가 접히지 않는다', () => {
  const w = quoteColumnWidths({ showDiscount: true, showRemark: true, longRemark: true, content: WIDE })
  assert.ok(usable(w.amount) >= 146, `금액 ${w.amount}% 에 큰 「330,000,000원」(146px)이 안 들어간다`)
  assert.ok(usable(w.discount) >= 87, `할인 ${w.discount}% 에 「30% → 100%」(87px)가 안 들어간다 — 실측 2026-10-20 에 15% 에서 접혔다`)
  assert.ok(usable(w.unitPrice) >= 90, `단가 ${w.unitPrice}% 에 「330,000,000원」(90px)이 안 들어간다`)
  assert.ok(w.name >= 10, `가장 넓은 경우에도 품목 이름은 남아야 한다 (${w.name}%)`)
  const p = quoteColumnWidths({ showDiscount: true, showRemark: true, longRemark: true, content: PLAIN })
  assert.ok(usable(p.unitPrice) >= 82, `단가 ${p.unitPrice}% 에 「13,000,000원」(82px)이 넘친다 — 고치기 전 실측 사고`)
})

test('★ 화살표가 없으면 할인 칸이 좁아지고 그 폭이 품목 이름으로 간다', () => {
  const plain = quoteColumnWidths({ showDiscount: true, showRemark: true, longRemark: true, content: PLAIN })
  const wide = quoteColumnWidths({ showDiscount: true, showRemark: true, longRemark: true, content: { ...PLAIN, discount: ['30% → 100%'] } })
  assert.ok(plain.discount < wide.discount, '화살표 없는 할인 칸이 안 좁아졌다')
  assert.equal(plain.name - wide.name, wide.discount - plain.discount, '줄어든 할인 폭이 이름으로 안 갔다')
  // 고치기 전 이 견적은 할인 16%, 이름 16% 였다(실측 116px)
  assert.ok(plain.discount <= 9, `「100%」 하나 담는 칸이 ${plain.discount}% 다`)
  assert.ok(plain.name >= 20, `이름 칸이 ${plain.name}% 다 — 고치기 전 16%`)
})

test('★ 특별 할인 표시가 있으면 할인 칸이 그 글자만큼은 된다', () => {
  const w = quoteColumnWidths({ showDiscount: true, showRemark: false, content: { ...PLAIN, discount: ['100%'], discountTag: ['특별 할인'] } })
  assert.ok(usable(w.discount) >= 5 * 11, `「특별 할인」이 ${w.discount}% 칸에서 접힌다`)
})

test('★ 비고가 길면 비고 열이 넓어지고 이름에서 떼어 온다', () => {
  const short = quoteColumnWidths({ showDiscount: true, showRemark: true, longRemark: false, content: PLAIN })
  const long = quoteColumnWidths({ showDiscount: true, showRemark: true, longRemark: true, content: PLAIN })
  assert.equal(short.remark, 10)
  assert.equal(long.remark, 15, '긴 비고인데 폭이 그대로다')
  assert.equal(short.unitPrice, long.unitPrice, '단가에서 떼어 갔다 — 「13,000,000원」이 넘친 원인')
  assert.equal(short.name - long.name, 5)
})

test('★ 비고 열이 안 서면 긴 비고 여부는 폭을 안 바꾼다', () => {
  const a = quoteColumnWidths({ showDiscount: true, showRemark: false, longRemark: true, content: PLAIN })
  const b = quoteColumnWidths({ showDiscount: true, showRemark: false, longRemark: false, content: PLAIN })
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

test('★ 좁은 화면의 표 최소 폭이 셈의 기준 폭과 같다 — 작으면 390 화면에서 금액이 칸을 넘는다', () => {
  const css = readFileSync(new URL('../../app/(crm)/crm/quotes/[id]/quote-document.module.css', import.meta.url), 'utf8')
  const m = css.match(/\.table \{ min-width: ([\d.]+)rem; \}/)
  assert.ok(m, '표 최소 폭 규칙이 없다')
  assert.equal(Number(m[1]) * 16, BASIS_PX, `표 최소 폭 ${m[1]}rem 이 기준 폭 ${BASIS_PX}px 과 다르다`)
})
