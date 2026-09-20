/**
 * 견적서 문서 읽기 스키마·프롬프트 가드
 *
 * **여기가 마지막 문이다.** 이 스키마를 지난 값은 화면에 항목으로 뜨고,
 * 사람이 체크하면 그대로 고객에게 나가는 견적이 된다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  QuoteFromDocOutputSchema, parseQuoteFromDoc, parseQuoteFromDocDoc,
  MAX_DOC_LINES, MAX_DOC_QUOTES, MAX_DOC_COMPONENT_LINES, MAX_COMPONENT_TEXT,
} from './quote-from-doc.ts'
import { QUOTE_FROM_DOC_V1 } from '../prompts/quote-from-doc.v1.ts'

const base = {
  title: 'KTL 하드웨어 납품 견적',
  currency: 'KRW',
  customerName: '한국산업기술시험원',
  issuedOn: '2026-03-14',
  lines: [] as unknown[],
  sourceTotalMinor: 110000000,
  sourceTotalIncludesTax: true,
  taxPercent: 10,
  unclear: [],
}

const line = {
  name: 'H100 80GB SXM',
  spec: 'SXM5',
  kind: 'QUANTITY',
  quantity: 2,
  unit: '대',
  unitPriceMinor: 50000000,
  discountPercent: null,
  specialDiscountPercent: null,
  amountMinor: 100000000,
  sourceText: 'H100 80GB SXM | 2 | 50,000,000 | 100,000,000',
}

/* ── 검산 거리 ───────────────────────────────────── */

test('★ 줄마다 원문 조각을 담는다 — 대조할 수 없는 값은 검수가 안 된다', () => {
  const r = QuoteFromDocOutputSchema.parse({ ...base, lines: [line] })
  assert.equal(r.lines[0].sourceText, 'H100 80GB SXM | 2 | 50,000,000 | 100,000,000')
})

test('★ 원문 조각이 없으면 빈 문자열이다 — null 이면 그 줄이 대조 없이 통과한다', () => {
  const r = QuoteFromDocOutputSchema.parse({ ...base, lines: [{ ...line, sourceText: undefined }] })
  assert.equal(r.lines[0].sourceText, '', '칸 자체가 사라지면 화면이 「근거 없음」을 못 띄운다')
})

test('★ 문서에 적힌 줄 금액을 따로 받는다 — 수량×단가와 대조할 자리다', () => {
  const r = QuoteFromDocOutputSchema.parse({ ...base, lines: [line] })
  assert.equal(r.lines[0].amountMinor, 100000000)
})

test('★ 문서에 적힌 합계를 따로 받는다 — 우리 합계와 대조할 유일한 근거다', () => {
  const r = QuoteFromDocOutputSchema.parse({ ...base, lines: [line] })
  assert.equal(r.sourceTotalMinor, 110000000)
  assert.equal(r.sourceTotalIncludesTax, true)
})

test('합계를 못 찾으면 null 이다 — 화면이 「대조할 합계가 없다」고 말할 수 있어야 한다', () => {
  const r = QuoteFromDocOutputSchema.parse({ ...base, sourceTotalMinor: null, lines: [line] })
  assert.equal(r.sourceTotalMinor, null)
})

/* ── 0 으로 눕히지 않는다 ────────────────────────── */

test('★ 단가를 못 읽으면 null 이고 스키마가 통과한다 — 0 으로 눕히면 0원 줄이 조용히 들어간다', () => {
  const r = QuoteFromDocOutputSchema.parse({ ...base, lines: [{ ...line, unitPriceMinor: null }] })
  assert.equal(r.lines[0].unitPriceMinor, null)
})

test('할인율이 안 적혀 있으면 null 이다 — 0 은 「0% 할인」이라 뜻이 다르다', () => {
  const r = QuoteFromDocOutputSchema.parse({ ...base, lines: [{ ...line, discountPercent: null }] })
  assert.equal(r.lines[0].discountPercent, null)
})

/* ── 한국식 표기 ─────────────────────────────────── */

test('★ 「1,200,000원」류 표기를 정수로 푼다 — 붙여넣기 경로와 같은 규칙이어야 금액이 안 갈린다', () => {
  const r = QuoteFromDocOutputSchema.parse({
    ...base,
    sourceTotalMinor: '110,000,000원',
    lines: [{ ...line, unitPriceMinor: '50,000,000', amountMinor: ' 100000000 ' }],
  })
  assert.equal(r.sourceTotalMinor, 110000000)
  assert.equal(r.lines[0].unitPriceMinor, 50000000)
  assert.equal(r.lines[0].amountMinor, 100000000)
})

test('수량은 소수를 허용한다 — 「0.5 M/M」이 실제로 있다', () => {
  const r = QuoteFromDocOutputSchema.parse({ ...base, lines: [{ ...line, quantity: 0.5 }] })
  assert.equal(r.lines[0].quantity, 0.5)
})

test('음수 금액은 거절한다 — 견적서에 마이너스 단가는 없다(할인은 DISCOUNT 줄이다)', () => {
  assert.throws(() => QuoteFromDocOutputSchema.parse({
    ...base, lines: [{ ...line, unitPriceMinor: -1 }],
  }))
})

/* ── 종류 ───────────────────────────────────────── */

test('★ 모르는 kind 는 거절한다 — QUANTITY 로 눕히면 라벨이 실제와 달라진다', () => {
  assert.throws(() => QuoteFromDocOutputSchema.parse({
    ...base, lines: [{ ...line, kind: 'SOMETHING' }],
  }))
})

test('kind 가 null 이면 통과한다 — 모르겠다는 말을 할 수 있어야 한다', () => {
  const r = QuoteFromDocOutputSchema.parse({ ...base, lines: [{ ...line, kind: null }] })
  assert.equal(r.lines[0].kind, null)
})

/* ── 상한 ───────────────────────────────────────── */

test('★ 항목이 상한을 넘으면 «자르고 몇 개를 잘랐는지 말한다» — 던지면 그 문서 전체를 못 읽는다', () => {
  const many = Array.from({ length: MAX_DOC_LINES + 3 }, () => line)
  const r = parseQuoteFromDocDoc(JSON.stringify({ quotes: [{ ...base, lines: many }], unclear: [] }))
  assert.equal(r.quotes[0].lines.length, MAX_DOC_LINES)
  assert.equal(r.droppedLines, 3, '잘라 놓고 안 세면 화면이 200건을 전부라고 말한다')
})

test('원문 조각이 길면 잘린다 — 프롬프트 응답이 통째로 죽는 것보다 낫다', () => {
  const r = QuoteFromDocOutputSchema.parse({
    ...base, lines: [{ ...line, sourceText: '가'.repeat(1000) }],
  })
  assert.ok(r.lines[0].sourceText.length <= 300)
})

/* ── 파서 ───────────────────────────────────────── */

test('★ 코드펜스를 벗긴다 — 모델이 ```json 으로 감싸는 일이 흔하다', () => {
  const r = parseQuoteFromDoc('```json\n' + JSON.stringify({ ...base, lines: [line] }) + '\n```')
  assert.equal(r.lines.length, 1)
})

/* ── 한 장에 여러 건 ─────────────────────────────── */

/*
  한 딜에 견적이 하나일 이유가 없다(사용자 지시 2026-09-19).
  한 건으로 뭉치면 두 건의 항목이 한 줄기로 섞이고, 합계 대조는 둘 중 하나와만
  견주게 되어 늘 안 맞는다고 뜬다.
*/

const quoteA = {
  label: '1안', title: '기본 구성', currency: 'KRW',
  customerName: '한국산업기술시험원', supplierName: '데이터얼라이언스', issuedOn: '2026-03-14',
  lines: [line], sourceTotalMinor: 110000000, sourceTotalIncludesTax: true, taxPercent: 10,
}
const quoteB = {
  ...quoteA, label: '2안', title: '확장 구성',
  supplierName: '지코어', sourceTotalMinor: 220000000,
  lines: [{ ...line, name: 'H200 141GB', amountMinor: 200000000 }],
}

test('★ 건이 둘이면 둘로 읽는다 — 뭉치면 합계 대조가 늘 안 맞는다고 뜬다', () => {
  const r = parseQuoteFromDocDoc(JSON.stringify({ quotes: [quoteA, quoteB], unclear: [] }))
  assert.equal(r.quotes.length, 2)
  assert.equal(r.quotes[0].title, '기본 구성')
  assert.equal(r.quotes[1].title, '확장 구성')
})

test('★ 합계와 제목과 통화는 건마다 따로다 — 문서 하나에 하나면 둘째 건은 남의 합계로 검산된다', () => {
  const r = parseQuoteFromDocDoc(JSON.stringify({ quotes: [quoteA, quoteB], unclear: [] }))
  assert.equal(r.quotes[0].sourceTotalMinor, 110000000)
  assert.equal(r.quotes[1].sourceTotalMinor, 220000000)
  assert.equal(r.quotes[0].lines[0].name, 'H100 80GB SXM')
  assert.equal(r.quotes[1].lines[0].name, 'H200 141GB')
})

test('★ 옛 한 건 모양(최상위 lines)도 1건으로 읽는다 — 거절하면 읽히는 문서를 못 읽었다고 말하게 된다', () => {
  const r = parseQuoteFromDocDoc(JSON.stringify({ ...base, lines: [line] }))
  assert.equal(r.quotes.length, 1)
  assert.equal(r.quotes[0].lines.length, 1)
  assert.equal(r.quotes[0].sourceTotalMinor, 110000000)
})

test('건을 하나도 못 찾으면 빈 목록이다 — 그때는 화면이 「못 찾았다」고 말한다', () => {
  const r = parseQuoteFromDocDoc(JSON.stringify({ unclear: ['표가 그림이라 안 읽힘'] }))
  assert.deepEqual(r.quotes, [])
  assert.deepEqual(r.unclear, ['표가 그림이라 안 읽힘'])
})

test('★ 상한을 넘으면 몇 건을 못 읽었는지 남긴다 — 조용히 버리면 사람은 그게 전부인 줄 안다', () => {
  const many = Array.from({ length: MAX_DOC_QUOTES + 3 }, () => quoteA)
  const r = parseQuoteFromDocDoc(JSON.stringify({ quotes: many, unclear: [] }))
  assert.equal(r.quotes.length, MAX_DOC_QUOTES)
  assert.equal(r.droppedQuotes, 3)
})

test('건 안에 적힌 「못 읽음」도 모은다 — 문서 칸만 보면 그 이야기가 사라진다', () => {
  const r = parseQuoteFromDocDoc(JSON.stringify({
    quotes: [{ ...quoteA, unclear: ['2안 단가가 각주에만 있음'] }],
    unclear: ['3쪽이 그림'],
  }))
  assert.deepEqual(r.unclear, ['3쪽이 그림', '2안 단가가 각주에만 있음'])
})

test('★ 낸 쪽 상호를 받는다 — 우리 상호와 견줄 값이 없으면 라벨을 만들 수 없다', () => {
  const r = parseQuoteFromDocDoc(JSON.stringify({ quotes: [quoteB], unclear: [] }))
  assert.equal(r.quotes[0].supplierName, '지코어')
})

test('문서가 부르는 이름(1안·2안)을 그대로 들고 온다 — 사람이 원문에서 그 건을 찾아야 한다', () => {
  const r = parseQuoteFromDocDoc(JSON.stringify({ quotes: [quoteA, quoteB], unclear: [] }))
  assert.deepEqual(r.quotes.map((q) => q.label), ['1안', '2안'])
})

test('★ 한 건만 채우는 경로는 첫 건을 받는다 — 모달의 채우기가 그대로 동작해야 한다', () => {
  const r = parseQuoteFromDoc(JSON.stringify({ quotes: [quoteA, quoteB], unclear: ['3쪽이 그림'] }))
  assert.equal(r.title, '기본 구성')
  assert.equal(r.lines.length, 1)
  assert.deepEqual(r.unclear, ['3쪽이 그림'])
})

/* ── 프롬프트 ────────────────────────────────────── */

test('★ 합계 행을 항목으로 넣지 말라고 적혀 있다 — 넣으면 금액이 두 배가 된다', () => {
  const p = QUOTE_FROM_DOC_V1.build('원문')
  for (const word of ['소계', '부가세', '합계']) {
    assert.ok(p.includes(word), `「${word}」 행 처리 지시가 없다`)
  }
  assert.match(p, /항목이 아니다/)
})

test('★ 역산 금지가 적혀 있다 — 역산한 할인율은 문서에 없던 숫자고 그것이 인쇄된다', () => {
  const p = QUOTE_FROM_DOC_V1.build('원문')
  assert.match(p, /역산하지 마라|나누지 마라/)
})

test('★ 0 으로 눕히지 말라고 적혀 있다', () => {
  assert.match(QUOTE_FROM_DOC_V1.build('원문'), /0 을 넣지 마라/)
})

test('★ 원문이 프롬프트에 실린다 — 안 실으면 모델이 빈 문서를 읽는다', () => {
  assert.ok(QUOTE_FROM_DOC_V1.build('##표\n가 | 나').includes('##표\n가 | 나'))
})

test('프롬프트 판번호가 있다 — 어느 판에서 나온 답인지 기록에 남아야 한다', () => {
  assert.match(QUOTE_FROM_DOC_V1.version, /^quote_from_doc@v\d+\.\d+\.\d+$/)
})

test('★ 건을 가르는 기준이 적혀 있다 — 기준이 없으면 모델이 쪽마다 새 건을 만든다', () => {
  const p = QUOTE_FROM_DOC_V1.build('원문')
  for (const word of ['1안', '견적번호', '공급자']) {
    assert.ok(p.includes(word), `건을 가르는 기준에 「${word}」가 없다`)
  }
  assert.match(p, /합계.*여러 번/, '합계가 여러 번 나오는 것이 기준이라고 안 적혀 있다')
})

test('★ 억지로 나누지 말라고 적혀 있다 — 소계·부속명세는 묶음이지 다른 건이 아니다', () => {
  const p = QUOTE_FROM_DOC_V1.build('원문')
  assert.match(p, /억지로 나누지 마라/)
  assert.ok(p.includes('부속명세'), '한 건 안의 묶음을 다른 건으로 읽는다')
})

test('★ 출력 형식이 건 목록이다 — 예시가 옛 모양이면 모델이 옛 모양으로 답한다', () => {
  const p = QUOTE_FROM_DOC_V1.build('원문')
  assert.match(p, /"quotes":\s*\[/)
  assert.ok(p.includes('"supplierName"'), '낸 쪽 상호를 안 물어본다')
})


/* ── 구성·쪽·묶음 (v0.10.30x) ───────────────────── */

/*
  **왜 여기서 보나**: 실측 2026-09-20, 원본 20줄짜리 표에서 6줄만 들어왔다.
  사라진 14줄 가운데 13줄이 「품목 칸이 비고 설명만 이어지는 행」이었다.
  그 행을 담을 자리가 스키마에 없었던 것이 원인이고, 이 절이 그 자리를 지킨다.
*/

test('★ 항목이 구성 줄을 담는다 — 담을 자리가 없어 13줄이 사라졌다', () => {
  const r = QuoteFromDocOutputSchema.parse({
    ...base,
    lines: [{ ...line, components: ['Dual AMD EPYC 9005/9004', '12-Channel DDR5 RDIMM', '24 x 2.5" Gen5 NVMe'] }],
  })
  assert.deepEqual(r.lines[0].components, [
    'Dual AMD EPYC 9005/9004', '12-Channel DDR5 RDIMM', '24 x 2.5" Gen5 NVMe',
  ])
})

test('구성이 없으면 빈 목록이다 — null 을 그리면 화면이 「null」을 인쇄한다', () => {
  const r = QuoteFromDocOutputSchema.parse({ ...base, lines: [line] })
  assert.deepEqual(r.lines[0].components, [])
})

test('★ 구성이 상한을 넘으면 자르고 센다', () => {
  const many = Array.from({ length: MAX_DOC_COMPONENT_LINES + 5 }, (_, i) => `구성 ${i}`)
  const r = parseQuoteFromDocDoc(JSON.stringify({
    quotes: [{ ...base, lines: [{ ...line, components: many }] }], unclear: [],
  }))
  assert.equal(r.quotes[0].lines[0].components.length, MAX_DOC_COMPONENT_LINES)
  assert.equal(r.droppedComponents, 5)
})

test('★ 상한을 설정에서 받는다 — 회사마다 견적서 두께가 다르다', () => {
  const many = Array.from({ length: 10 }, (_, i) => `구성 ${i}`)
  const r = parseQuoteFromDocDoc(
    JSON.stringify({ quotes: [{ ...base, lines: [{ ...line, components: many }] }], unclear: [] }),
    { maxLines: 50, maxComponentLines: 4 },
  )
  assert.equal(r.quotes[0].lines[0].components.length, 4)
  assert.equal(r.droppedComponents, 6)
})

test('구성 한 줄이 너무 길면 자른다 — 그건 구성이 아니라 문단이다', () => {
  const r = QuoteFromDocOutputSchema.parse({
    ...base, lines: [{ ...line, components: ['가'.repeat(500)] }],
  })
  assert.equal(r.lines[0].components[0].length, MAX_COMPONENT_TEXT)
})

test('빈 구성 줄은 버린다 — 빈 줄이 인쇄되면 견적서에 구멍이 생긴다', () => {
  const r = QuoteFromDocOutputSchema.parse({
    ...base, lines: [{ ...line, components: ['가', '   ', '', '나'] }],
  })
  assert.deepEqual(r.lines[0].components, ['가', '나'])
})

test('★ 규격이 300자를 넘어도 문서 전체가 안 죽는다 — 예전엔 여기서 통째로 실패했다', () => {
  const r = parseQuoteFromDocDoc(JSON.stringify({
    quotes: [{ ...base, lines: [{ ...line, spec: '가'.repeat(420) }] }], unclear: [],
  }))
  assert.equal(r.quotes[0].lines[0].spec?.length, 300)
  assert.equal(r.quotes[0].lines.length, 1, '한 줄이 길다고 견적서 한 장을 버리면 안 된다')
})

test('★ 건과 줄이 어느 쪽에서 왔는지 담는다 — 없으면 대조가 늘 1쪽부터 열린다', () => {
  const r = parseQuoteFromDocDoc(JSON.stringify({
    quotes: [{
      ...base, pageStart: 2, pageEnd: '3쪽',
      lines: [{ ...line, sourcePage: 2 }],
    }],
    unclear: [],
  }))
  assert.equal(r.quotes[0].pageStart, 2)
  assert.equal(r.quotes[0].pageEnd, 3, '「3쪽」처럼 적어 와도 숫자로 읽는다')
  assert.equal(r.quotes[0].lines[0].sourcePage, 2)
})

test('쪽을 못 읽었으면 null 이다 — 0 이나 1 로 눕히면 틀린 쪽을 오려 붙인다', () => {
  const r = parseQuoteFromDocDoc(JSON.stringify({
    quotes: [{ ...base, pageStart: '모름', lines: [{ ...line, sourcePage: 0 }] }], unclear: [],
  }))
  assert.equal(r.quotes[0].pageStart, null)
  assert.equal(r.quotes[0].lines[0].sourcePage, null)
})

test('★ 원본이 묶어 부르는 말을 그대로 받는다 — 펴서 받으면 사람이 다시 묶어야 한다', () => {
  const r = QuoteFromDocOutputSchema.parse({
    ...base, lines: [{ ...line, groupLabel: '하드웨어' }],
  })
  assert.equal(r.lines[0].groupLabel, '하드웨어')
})
