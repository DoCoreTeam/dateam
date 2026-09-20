// 할인 표시 가드 — **안 준 할인을 말하지 않는다**
//
// **왜 이 가드가 생겼나**: 할인이 0인 견적서에 「할인 0원」이 찍혀 나갔다.
// 받는 쪽은 그것을 «빈칸»이 아니라 «일부러 안 줬다»로 읽는다
// (사용자 지적 2026-09-20: 「할인이 없는데 할인이 나오면 일부러 안 해 주는 것 같지 않나」).
//
// **세 표면이 같은 답을 봐야 한다.** 화면·편집 합계·엑셀이 각자 판정하면
// 화면엔 없는 할인 칸이 파일엔 남는 날이 오고, 그때부터 같은 견적이 두 얼굴을 갖는다.
//
// **이름만 찾지 않는다.** `hasDiscount` 를 import 만 해 두고 안 쓰거나, 조건줄을
// 주석 처리해도 이름은 파일에 남는다 — 그래서 **조건식과 함께** 본다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildQuoteDocument, hasDiscount } from './quote-document.ts'

const SHEET = readFileSync(
  new URL('../../../app/(crm)/crm/quotes/[id]/QuoteSheet.tsx', import.meta.url), 'utf8')
const TOTALS = readFileSync(
  new URL('../../../components/ui/crm/QuoteTotals.tsx', import.meta.url), 'utf8')
const XLSX = readFileSync(new URL('../services/quote-xlsx.ts', import.meta.url), 'utf8')

/** 주석에 남은 코드는 코드가 아니다 — 줄 앞이 `//` 인 줄은 못 세게 한다 */
function liveLines(src: string): string[] {
  return src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
}

test('★ 판정은 문서 SSOT 한 곳에서 온다 — 표면마다 따로 세면 답이 갈린다', () => {
  for (const [name, src] of [['견적서', SHEET], ['엑셀', XLSX]] as const) {
    assert.ok(
      liveLines(src).some((l) => /(const|=)\s*showDiscount\s*=\s*hasDiscount\(doc\)/.test(l)),
      `${name} 가 hasDiscount 로 판정하지 않는다`,
    )
  }
})

test('★ 견적서: 할인 열과 할인 줄이 조건 뒤에 있다', () => {
  const live = liveLines(SHEET).join('\n')
  // 열 폭·머리글·항목 칸 — 셋이 다 조건 뒤여야 열 수가 맞는다
  assert.ok(/\{showDiscount && <col /.test(live), '할인 열 폭이 조건 뒤에 없다')
  assert.ok(/\{showDiscount && \(\s*\n\s*<th /.test(live), '할인 머리글이 조건 뒤에 없다')
  assert.ok(/\{showDiscount && \(\s*\n\s*<td className=\{styles\.num\}>/.test(live), '항목의 할인 칸이 조건 뒤에 없다')
  // 합계의 할인 줄
  assert.ok(/\{showDiscount && \(\s*\n\s*<tr>/.test(live), '합계의 할인 줄이 조건 뒤에 없다')
  /*
    **colSpan 은 전부 열 수에서 나온다.** 하나라도 숫자를 박아 두면 할인 칸이 빠진 날
    그 줄만 한 칸 밀려 표가 어긋난다 — 화면에서는 티가 안 나고 종이에서 드러난다.
  */
  const hardCoded = live.match(/colSpan=\{[0-9]+\}/g) ?? []
  assert.deepEqual(
    hardCoded.filter((c) => c !== 'colSpan={4}'), [],
    `열 수를 숫자로 박은 자리가 있다: ${hardCoded.join(', ')}`,
  )
  assert.ok(/const cols = showDiscount \? 7 : 6/.test(live), '열 수가 조건에서 안 나온다')
})

test('★ 편집 합계: 할인 줄이 조건 뒤에 있다', () => {
  const live = liveLines(TOTALS).join('\n')
  assert.ok(
    /\{totals\.discountMinor !== BigInt\(0\) && \(/.test(live),
    '편집 합계가 할인 0에도 할인 줄을 그린다',
  )
})

test('★ 엑셀: 합계 행·머리글·열 숨김이 모두 조건 뒤에 있다', () => {
  const live = liveLines(XLSX).join('\n')
  assert.ok(/\.\.\.\(showDiscount\s*\n?\s*\?\s*\[\[QUOTE\.discount/.test(live), '합계에서 할인 행을 안 뺀다')
  assert.ok(/c\.key === 'disc' && !showDiscount/.test(live), '표 머리글의 할인 글자를 안 비운다')
  assert.ok(/if \(!showDiscount\) ws\.getColumn\(6\)\.hidden = true/.test(live), '할인 열을 안 숨긴다')
  /*
    **행 번호도 조건에서 나온다.** 할인 줄이 빠지면 아래가 한 칸씩 당겨지는데,
    수식이 옛 행을 가리키면 **엑셀에서만 틀린다** — 화면으로는 안 보이는 사고다.
  */
  assert.ok(/const discountRow = showDiscount \? r \+ 1 : null/.test(live), '할인 행 번호가 조건에서 안 나온다')
  assert.ok(/const taxRow = r \+ \(showDiscount \? 2 : 1\)/.test(live), '부가세 행 번호가 조건에서 안 나온다')
})

test('★ 판정은 합계와 항목을 둘 다 본다 — 한쪽만 보면 할 말이 사라진다', () => {
  const base = {
    quote: {
      quoteNo: 'Q-1', title: '견적', currency: 'KRW', validUntil: null,
      createdAt: '2026-09-20T00:00:00.000Z',
      subtotalMinor: BigInt(100), discountMinor: BigInt(0),
      taxMinor: BigInt(10), totalMinor: BigInt(110), notesMd: null,
    },
    customer: { companyName: '가나다', personName: null, fallbackName: '딜' },
    supplier: { name: '우리' },
    todayKey: '2026-09-20',
  }
  const plain = buildQuoteDocument({
    ...base,
    lines: [{ name: 'A', quantity: '1', unitPriceMinor: BigInt(100), discountPercent: '0', lineTotalMinor: BigInt(100) }],
  } as never)
  assert.equal(hasDiscount(plain), false)

  // 합계는 0인데 항목에 할인율이 남은 문서 — 열을 지우면 그 비율이 갈 곳이 없다
  const perLine = buildQuoteDocument({
    ...base,
    lines: [{ name: 'A', quantity: '1', unitPriceMinor: BigInt(100), discountPercent: '10', lineTotalMinor: BigInt(90) }],
  } as never)
  assert.equal(hasDiscount(perLine), true)
})
