/**
 * 원문 대조 가드
 *
 * 이 계산이 틀리면 **틀린 견적이 「맞습니다」를 달고 들어간다.**
 * 경고를 못 띄우는 것보다 나쁜 것은, 틀렸는데 맞다고 말하는 것이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  checkLine, checkTotal, initialChecked, LINE_TOLERANCE_MINOR,
  type LineCheckInput,
} from './quote-reconcile.ts'

function line(over: Partial<LineCheckInput> = {}): LineCheckInput {
  return {
    name: 'H100 SXM',
    quantity: '2',
    unitPriceMinor: '50000000',
    discountPercent: '0',
    taxRate: '10',
    documentAmountMinor: 100000000,
    sourceText: 'H100 SXM | 2 | 50,000,000 | 100,000,000',
    ...over,
  }
}

/* ── 줄 대조 ─────────────────────────────────────── */

test('★ 수량 × 단가가 문서 금액과 같으면 안전한 줄이다', () => {
  const c = checkLine(line())
  assert.equal(c.safe, true)
  assert.equal(c.diffMinor, BigInt(0))
  assert.deepEqual(c.reasons, [])
})

test('★ 수량과 단가가 뒤집히면 잡힌다 — AI 는 이때도 성공한 것처럼 답한다', () => {
  // 「2대 × 5천만」을 「5천만대 × 2원」으로 읽은 경우가 아니라, 흔한 쪽:
  // 단가 칸에서 금액을 읽어 와 2배가 된 경우
  const c = checkLine(line({ unitPriceMinor: '100000000' }))
  assert.ok(c.reasons.includes('amount_mismatch'))
  assert.equal(c.diffMinor, BigInt(100000000))
  assert.equal(c.safe, false)
})

test('★ 할인을 못 읽으면 금액이 안 맞아 잡힌다', () => {
  // 문서에는 20% 할인 뒤 8천만이 적혔는데 할인을 0으로 읽었다
  const c = checkLine(line({ documentAmountMinor: 80000000 }))
  assert.ok(c.reasons.includes('amount_mismatch'))
  assert.equal(c.diffMinor, BigInt(20000000))
})

test('할인을 제대로 읽었으면 맞는다', () => {
  const c = checkLine(line({ discountPercent: '20', documentAmountMinor: 80000000 }))
  assert.equal(c.safe, true)
})

test('★ 1원 차이는 봐준다 — 견적서는 원 단위로 반올림한 숫자를 인쇄한다', () => {
  const c = checkLine(line({ documentAmountMinor: 100000001 }))
  assert.ok(!c.reasons.includes('amount_mismatch'), `${c.diffMinor} 원 차이로 잡혔다`)
})

test('2원 차이는 잡는다 — 봐주는 폭이 커지면 진짜 오독이 숨는다', () => {
  const c = checkLine(line({ documentAmountMinor: 100000002 }))
  assert.ok(c.reasons.includes('amount_mismatch'))
  assert.equal(LINE_TOLERANCE_MINOR, BigInt(1))
})

test('★ 부가세는 빼고 대조한다 — 항목 표에 적히는 것은 공급가액이다', () => {
  // 부가세 10% 를 얹으면 1억 1천만이지만 문서 항목 줄에는 1억이 적힌다
  const c = checkLine(line({ taxRate: '10', documentAmountMinor: 100000000 }))
  assert.equal(c.safe, true)
})

test('★ 문서에 줄 금액이 없으면 대조하지 않는다 — 없는 근거로 경고하지 않는다', () => {
  const c = checkLine(line({ documentAmountMinor: null }))
  assert.equal(c.diffMinor, null)
  assert.ok(!c.reasons.includes('amount_mismatch'))
  assert.equal(c.safe, true)
})

/* ── 줄의 다른 위험 ──────────────────────────────── */

test('★ 단가를 못 읽은 줄은 위험하다 — 빈 칸이 0원으로 들어간다', () => {
  const c = checkLine(line({ unitPriceMinor: '', documentAmountMinor: null }))
  assert.ok(c.reasons.includes('no_price'))
  assert.equal(c.safe, false)
})

test('「0원」이라고 읽은 것과 「못 읽었다」는 다르다', () => {
  const zero = checkLine(line({ unitPriceMinor: '0', documentAmountMinor: 0 }))
  assert.ok(!zero.reasons.includes('no_price'), '0 은 읽은 값이다')
})

test('이름 없는 줄은 위험하다 — 견적서에 이름 없는 줄이 인쇄된다', () => {
  const c = checkLine(line({ name: '   ' }))
  assert.ok(c.reasons.includes('no_name'))
})

test('★ 원문 조각이 없으면 위험하다 — 사람이 대조할 근거가 없다', () => {
  const c = checkLine(line({ sourceText: '' }))
  assert.ok(c.reasons.includes('no_source'))
  assert.equal(c.safe, false)
})

/* ── 합계 대조 ───────────────────────────────────── */

test('★ 합계가 맞으면 match', () => {
  const r = checkTotal({
    lines: [line(), line({ documentAmountMinor: 100000000 })],
    documentTotalMinor: 200000000,
    documentIncludesTax: false,
  })
  assert.equal(r.verdict, 'match')
  assert.equal(r.diffMinor, BigInt(0))
})

test('★ 항목을 빠뜨리면 합계에서 드러난다 — 줄은 다 맞는데 합계가 모자란 경우다', () => {
  const r = checkTotal({
    lines: [line()],
    documentTotalMinor: 200000000,
    documentIncludesTax: false,
  })
  assert.equal(r.verdict, 'mismatch')
  assert.equal(r.diffMinor, BigInt(-100000000), '모자라면 음수다')
})

test('★ 문서 합계가 부가세 포함이면 우리도 포함해 견준다 — 기준이 다르면 10% 어긋나 보인다', () => {
  const withTax = checkTotal({
    lines: [line()],
    documentTotalMinor: 110000000,
    documentIncludesTax: true,
  })
  assert.equal(withTax.verdict, 'match')

  const wrongBasis = checkTotal({
    lines: [line()],
    documentTotalMinor: 110000000,
    documentIncludesTax: false,
  })
  assert.equal(wrongBasis.verdict, 'mismatch', '기준을 안 맞추면 늘 어긋난다')
})

test('★ 문서에 합계가 없으면 no_reference — 대조를 못 했다는 사실을 말해야 한다', () => {
  const r = checkTotal({ lines: [line()], documentTotalMinor: null, documentIncludesTax: false })
  assert.equal(r.verdict, 'no_reference')
  assert.equal(r.diffMinor, null)
  assert.equal(r.documentTotalMinor, null)
  assert.ok(r.ourTotalMinor > BigInt(0), '우리 합계는 여전히 보여 줄 수 있어야 한다')
})

test('★ 허용 폭이 항목 수만큼 늘어난다 — 줄마다 1원씩 어긋날 수 있다', () => {
  const lines = Array.from({ length: 20 }, () => line())
  const r = checkTotal({ lines, documentTotalMinor: 2000000015, documentIncludesTax: false })
  assert.equal(r.toleranceMinor, BigInt(20))
  assert.equal(r.verdict, 'match', '15원 차이가 20줄에서 잡히면 경고가 늘 뜬다')
})

test('허용 폭을 넘으면 잡는다', () => {
  const lines = Array.from({ length: 20 }, () => line())
  const r = checkTotal({ lines, documentTotalMinor: 2000000021, documentIncludesTax: false })
  assert.equal(r.verdict, 'mismatch')
})

/* ── 처음 체크 상태 ──────────────────────────────── */

test('★ 안전한 줄만 켜 둔다 — 전부 켜 두면 사람이 훑고 그냥 넣는다', () => {
  const checks = [
    checkLine(line()),
    checkLine(line({ unitPriceMinor: '' , documentAmountMinor: null })),
    checkLine(line({ documentAmountMinor: 999 })),
  ]
  assert.deepEqual(initialChecked(checks), [true, false, false])
})

test('위험 신호가 없으면 전부 켜진다 — 멀쩡한 견적서까지 손으로 켜게 하지 않는다', () => {
  const checks = [checkLine(line()), checkLine(line())]
  assert.deepEqual(initialChecked(checks), [true, true])
})

/* ── 화면이 그 계약을 지키나 ─────────────────────── */

/*
  대조 계산이 맞아도 **화면이 그 결과를 안 쓰면 없는 기능**이다.
  이 저장소가 반복한 사고가 정확히 그것이다 — 로직은 다 있고 화면만 안 불렀다.
*/

const PANEL = readFileSync(
  new URL('../../../components/ui/crm/QuoteFillPanel.tsx', import.meta.url), 'utf-8')
/*
  검수 목록은 **두 화면이 같은 것을 쓴다**(편집 모달의 「파일로 채우기」와 딜 화면의
  「파일로 가져오기」). 두 벌로 그리면 한쪽에만 위험 표시가 붙고, 검수 없는 쪽으로
  틀린 값이 들어온다 — 이 저장소가 반복한 사고가 정확히 그 모양이다.
*/
const REVIEW = readFileSync(
  new URL('../../../components/ui/crm/quote-review.tsx', import.meta.url), 'utf-8')

test('★ 체크한 것만 폼에 들어간다 — 자동 반영은 없다(§5-3)', () => {
  assert.match(REVIEW, /review\.lines\.filter\(\(_, i\) => review\.checked\[i\]\)/,
    '체크를 거르지 않고 통째로 넣는다')
  assert.match(PANEL, /pickedLines\(review\)/, '화면이 고른 것만 넣는 길을 안 쓴다')
  // 읽자마자 폼을 고치면 검수가 있으나 마나다
  const read = PANEL.slice(PANEL.indexOf('const readFile'), PANEL.indexOf('const applyReview'))
  assert.ok(!/onDraftChange\(/.test(read), '파일을 읽는 자리에서 폼을 고친다')
})

test('★ 처음 체크 상태를 자작하지 않는다 — 판정은 한 곳이다', () => {
  assert.match(REVIEW, /checked: initialChecked\(checks\)/)
  assert.ok(
    !/checked: lines\.map\(/.test(REVIEW),
    '화면이 스스로 「안전한 줄」을 판정하면 계산과 갈린다',
  )
})

test('★ 기존 항목을 지우지 않는다 — 빈 줄 하나뿐일 때만 갈아 끼운다', () => {
  assert.match(PANEL, /appendLines\(prev, picked\)/)
  const fn = REVIEW.slice(REVIEW.indexOf('export function appendLines'))
  assert.match(fn, /prev\.lines\.length === 1 && !prev\.lines\[0\]\.name\.trim\(\)/)
  assert.match(fn, /\[\.\.\.prev\.lines, \.\.\.made\]/)
})

test('★ 줄마다 원문 조각과 걸린 이유를 함께 보여 준다 — 못 보면 검수가 아니다', () => {
  assert.match(REVIEW, /review\.sources\[i\]/)
  assert.match(REVIEW, /review\.checks\[i\]\.reasons\.map\(\(r\) => FILL_RISK_TEXT\[r\]\)/)
})

test('★ 합계 대조를 화면이 그린다 — 맞았을 때도 말한다', () => {
  assert.match(REVIEW, /checkTotal\(\{/)
  assert.match(REVIEW, /data-verdict=\{review\.total\.verdict\}/)
  assert.match(REVIEW, /FILL_TOTAL_MATCH/)
  assert.match(REVIEW, /fillTotalMismatch\(/)
  assert.match(REVIEW, /FILL_TOTAL_NO_REFERENCE/)
})

test('★ 대조 계산을 화면이 다시 하지 않는다 — 두 곳이 다른 답을 내면 경고를 못 믿는다', () => {
  assert.ok(!/computeTotals\(/.test(PANEL), '화면이 합계를 직접 계산한다')
  assert.ok(!/computeTotals\(/.test(REVIEW), '검수 부품이 합계를 직접 계산한다')
  assert.match(REVIEW, /inputs\.map\(checkLine\)/)
})

/*
  ## 같은 목록을 두 번 그리지 않는다
*/

test('★ 검수 목록을 그리는 곳이 하나다 — 두 벌이면 한쪽만 고쳐진다', () => {
  // 목록을 그리는 표시는 부품에만 있고, 부르는 화면에는 없다
  for (const mark of [/styles\.reviewList/, /styles\.reviewItem/, /styles\.totalCheck\b/]) {
    assert.match(REVIEW, mark, '부품이 목록을 안 그린다')
    assert.ok(!mark.test(PANEL), `화면이 목록을 또 그린다: ${mark}`)
  }
  // 계산을 부르는 자리도 하나다
  assert.ok(!/checkLine|checkTotal|initialChecked/.test(PANEL),
    '화면이 대조 계산을 직접 부른다 — 부품을 거쳐야 한다')
})
