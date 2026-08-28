import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildQuoteDocument, verifyDocument, missingSupplierFields,
  type BuildQuoteDocumentInput,
} from './quote-document.ts'
import { hangulAmount, QUOTE } from '../../terms/quote.ts'

// ------------------------------------------------------------
// 한글 금액 — 견적서에 인쇄되는 값이라 틀리면 고객이 본다
// ------------------------------------------------------------

test('한글 금액: 만 단위 묶음이 자리마다 붙는다', () => {
  assert.equal(hangulAmount(0, 'KRW'), '금 영원정')
  assert.equal(hangulAmount(1, 'KRW'), '금 일원정')
  assert.equal(hangulAmount(10, 'KRW'), '금 일십원정')
  assert.equal(hangulAmount(1000, 'KRW'), '금 일천원정')
  assert.equal(hangulAmount(10000, 'KRW'), '금 일만원정')
  assert.equal(hangulAmount(120000000, 'KRW'), '금 일억이천만원정')
  assert.equal(hangulAmount(2000000000, 'KRW'), '금 이십억원정')
  assert.equal(hangulAmount(3500000000, 'KRW'), '금 삼십오억원정')
})

test('한글 금액: 1을 생략하지 않는다 — 생략은 글자를 끼워 넣을 자리를 만든다', () => {
  // 「천만원」이 아니라 「일천만원」
  assert.equal(hangulAmount(10000000, 'KRW'), '금 일천만원정')
  assert.equal(hangulAmount(100000000, 'KRW'), '금 일억원정')
})

test('한글 금액: 0인 자리는 건너뛴다', () => {
  // 1억 0천 0백만 = 「일억」 뒤에 만 단위 묶음이 통째로 없다
  assert.equal(hangulAmount(100000001, 'KRW'), '금 일억일원정')
  assert.equal(hangulAmount(1010, 'KRW'), '금 일천일십원정')
})

test('한글 금액: 조 단위까지 간다', () => {
  assert.equal(hangulAmount('1000000000000', 'KRW'), '금 일조원정')
})

test('한글 금액: 원 단위가 아니면 빈 문자열 — USD 견적에 「원정」이 찍히면 안 된다', () => {
  assert.equal(hangulAmount(120000, 'USD'), '')
  assert.equal(hangulAmount(120000, 'JPY'), '')
})

test('한글 금액: 음수는 만들지 않는다', () => {
  assert.equal(hangulAmount(-1000, 'KRW'), '')
})

// ------------------------------------------------------------
// 문서 조립
// ------------------------------------------------------------

// 덮어쓰기는 **통째 교체**다 — 부분 병합이면 「이 값만 비운다」를 시험할 수 없다
function input(over: Partial<BuildQuoteDocumentInput> = {}): BuildQuoteDocumentInput {
  const base: BuildQuoteDocumentInput = {
    quote: {
      quoteNo: 'Q-2026-0001',
      title: 'GPU 인프라 견적',
      currency: 'KRW',
      validUntil: '2026-09-30',
      createdAt: '2026-08-28T00:00:00.000Z',
      subtotalMinor: BigInt(100000000),
      discountMinor: BigInt(10000000),
      taxMinor: BigInt(9000000),
      totalMinor: BigInt(99000000),
      notesMd: '설치비 포함',
    },
    lines: over.lines ?? [
      { name: 'H100 80GB', unit: '대', quantity: '2', unitPriceMinor: BigInt(50000000), discountPercent: '10', lineTotalMinor: BigInt(90000000) },
    ],
    customer: { companyName: '가나다 주식회사', personName: '김담당', fallbackName: '딜 이름' },
    supplier: {
      name: '주식회사 우리', bizNo: '123-45-67890', ceo: '홍길동',
      address: '서울시 강남구', bizType: '서비스', bizItem: '소프트웨어',
      contact: '영업팀 02-000-0000', terms: '결제: 검수 후 30일\n납품: 계약 후 8주',
    },
    todayKey: '2026-08-28',
  }
  return { ...base, ...over }
}

test('문서 제목은 용어집에서 온다 — 화면이 「견적서」를 직접 적지 않는다', () => {
  assert.equal(buildQuoteDocument(input()).documentTitle, QUOTE.documentTitle)
})

test('항목에 번호가 1부터 붙는다', () => {
  const doc = buildQuoteDocument(input({
    lines: [
      { name: 'A', quantity: 1, unitPriceMinor: 100, lineTotalMinor: 100 },
      { name: 'B', quantity: 1, unitPriceMinor: 200, lineTotalMinor: 200 },
    ],
  }))
  assert.deepEqual(doc.lines.map((l) => l.no), [1, 2])
})

test('회사가 없는 딜이면 딜 이름이 「귀중」 앞에 선다 — 빈 칸은 문서가 아니다', () => {
  const doc = buildQuoteDocument(input({ customer: { companyName: null, fallbackName: '한국전자 국책과제' } }))
  assert.equal(doc.customer.companyName, '한국전자 국책과제')
})

test('업태·종목을 여러 줄로 등록해도 견적서엔 첫 줄만 — 다섯 줄이면 공급자 칸이 문서 절반을 먹는다', () => {
  const doc = buildQuoteDocument(input({
    supplier: {
      name: '데이터얼라이언스 주식회사',
      bizType: '서비스\n도소매\n소매\n서비스',
      bizItem: '소프트웨어 개발 및 공급\n단말기\n전자상거래\n컴퓨터시스템 통합 자문',
    },
  }))
  assert.equal(doc.supplier.bizType, '서비스')
  assert.equal(doc.supplier.bizItem, '소프트웨어 개발 및 공급')
})

test('한 줄만 등록한 기존 값도 그대로 동작한다', () => {
  const doc = buildQuoteDocument(input({ supplier: { name: '우리', bizType: '서비스업', bizItem: '소프트웨어' } }))
  assert.equal(doc.supplier.bizType, '서비스업')
})

test('빈 값은 «—» 로 채우지 않는다 — 그리는 쪽이 줄을 안 그린다', () => {
  const doc = buildQuoteDocument(input({ supplier: { name: '주식회사 우리' } }))
  assert.equal(doc.supplier.bizNo, '')
  assert.equal(doc.supplier.ceo, '')
})

test('견적일이 없으면 만든 날을 쓴다', () => {
  const doc = buildQuoteDocument(input())
  assert.equal(doc.meta.issuedOn, '2026-08-28')
})

test('거래 조건은 줄바꿈으로 나뉜다 — 빈 줄은 버린다', () => {
  const doc = buildQuoteDocument(input({ supplier: { terms: '결제: 30일\n\n납품: 8주\n' } }))
  assert.deepEqual(doc.terms, ['결제: 30일', '납품: 8주'])
})

test('조건이 비면 빈 배열 — 「조건 없음」 같은 말을 만들지 않는다', () => {
  const doc = buildQuoteDocument(input({ supplier: { terms: '' } }))
  assert.deepEqual(doc.terms, [])
})

test('유효기간이 지났으면 문서가 그렇다고 말한다', () => {
  const doc = buildQuoteDocument(input({ todayKey: '2026-10-01' }))
  assert.equal(doc.meta.expired, true)
})

test('유효기간 당일은 아직 안 지난 것이다', () => {
  const doc = buildQuoteDocument(input({ todayKey: '2026-09-30' }))
  assert.equal(doc.meta.expired, false)
})

test('저장 판정이 «만료 아님»이어도 날짜가 지났으면 지난 것이다', () => {
  // markExpired 는 SENT 만 판정한다 — 초안은 언제나 false 로 온다.
  // 그 값을 그대로 믿으면 7개월 지난 견적이 아무 표시 없이 인쇄된다.
  const doc = buildQuoteDocument(input({
    quote: { ...input().quote, validUntil: '2026-01-31', expired: false },
    todayKey: '2026-08-27',
  }))
  assert.equal(doc.meta.expired, true)
})

test('저장 판정이 «만료»면 날짜와 무관하게 만료다', () => {
  const doc = buildQuoteDocument(input({
    quote: { ...input().quote, validUntil: '2027-12-31', expired: true },
  }))
  assert.equal(doc.meta.expired, true)
})

test('유효기간이 없으면 만료가 아니다', () => {
  const doc = buildQuoteDocument(input({ quote: { ...input().quote, validUntil: null } }))
  assert.equal(doc.meta.expired, false)
})

test('금액은 문자열로 나간다 — JSON 이 BigInt 를 못 싣는다', () => {
  const doc = buildQuoteDocument(input())
  assert.equal(typeof doc.totals.totalMinor, 'string')
  assert.equal(doc.totals.totalMinor, '99000000')
  assert.equal(typeof doc.lines[0].amountMinor, 'string')
})

test('한글 금액이 총액과 붙어 나간다', () => {
  const doc = buildQuoteDocument(input())
  assert.equal(doc.totals.totalInWords, '금 구천구백만원정')
})

test('USD 견적에는 한글 금액이 없다', () => {
  const doc = buildQuoteDocument(input({ quote: { ...input().quote, currency: 'usd' } }))
  assert.equal(doc.meta.currency, 'USD')
  assert.equal(doc.totals.totalInWords, '')
})

// ------------------------------------------------------------
// 원가가 담길 자리가 없다 — 지우는 것이 아니라 못 담게 한다
// ------------------------------------------------------------

test('원가를 넣어도 문서에 실리지 않는다', () => {
  const withCost = {
    name: 'H100', quantity: 1, unitPriceMinor: 100, lineTotalMinor: 100,
    // 타입에 없는 필드 — 실수로 통째로 넘겨도 새지 않아야 한다
    costMinor: BigInt(70), marginPct: 30,
  }
  const doc = buildQuoteDocument(input({ lines: [withCost as never] }))
  const json = JSON.stringify(doc)
  assert.ok(!json.includes('costMinor'), '원가가 문서에 실렸다')
  assert.ok(!json.includes('marginPct'), '마진이 문서에 실렸다')
  assert.ok(!json.includes('"70"'), '원가 값이 문서에 실렸다')
})

// ------------------------------------------------------------
// 나가기 직전 검사
// ------------------------------------------------------------

test('맞는 문서는 위반이 없다', () => {
  assert.deepEqual(verifyDocument(buildQuoteDocument(input())), [])
})

test('항목 합이 «소계 − 할인» 과 다르면 잡는다', () => {
  const doc = buildQuoteDocument(input({
    lines: [{ name: 'A', quantity: 1, unitPriceMinor: 100, lineTotalMinor: BigInt(80000000) }],
  }))
  const vs = verifyDocument(doc)
  assert.equal(vs.length, 1)
  assert.equal(vs[0].code, 'I2')
  assert.match(vs[0].message, /차이/)
})

test('총액이 «소계 − 할인 + 세액» 과 다르면 잡는다', () => {
  const doc = buildQuoteDocument(input({
    quote: { ...input().quote, totalMinor: BigInt(1) },
  }))
  const vs = verifyDocument(doc)
  assert.equal(vs.length, 1)
  assert.equal(vs[0].code, 'I5')
})

test('두 군데가 동시에 어긋나면 둘 다 말한다 — 하나만 고치고 끝내지 않게', () => {
  const doc = buildQuoteDocument(input({
    lines: [{ name: 'A', quantity: 1, unitPriceMinor: 1, lineTotalMinor: BigInt(7) }],
    quote: { ...input().quote, totalMinor: BigInt(1) },
  }))
  assert.deepEqual(verifyDocument(doc).map((v) => v.code).sort(), ['I2', 'I5'])
})

test('가드를 일부러 깬다: 항목이 0건이면 소계도 0이어야 한다', () => {
  const doc = buildQuoteDocument(input({
    lines: [],
    quote: {
      ...input().quote,
      subtotalMinor: BigInt(0), discountMinor: BigInt(0), taxMinor: BigInt(0), totalMinor: BigInt(0),
    },
  }))
  assert.deepEqual(verifyDocument(doc), [])

  // 항목은 없는데 합계만 남은 문서 — 반드시 잡혀야 한다
  const ghost = buildQuoteDocument(input({ lines: [] }))
  assert.ok(verifyDocument(ghost).some((v) => v.code === 'I2'), '유령 합계를 못 잡았다')
})

// ------------------------------------------------------------
// 공급자 정보
// ------------------------------------------------------------

test('공급자 정보가 비면 무엇이 비었는지 이름으로 말한다', () => {
  const doc = buildQuoteDocument(input({ supplier: { name: '주식회사 우리', ceo: '홍길동' } }))
  assert.deepEqual(missingSupplierFields(doc), ['bizNo', 'address', 'bizType', 'bizItem'])
})

test('공급자 정보가 다 차면 빈 목록', () => {
  assert.deepEqual(missingSupplierFields(buildQuoteDocument(input())), [])
})

test('공백만 넣은 값은 채운 것으로 치지 않는다', () => {
  const doc = buildQuoteDocument(input({ supplier: { ...input().supplier, bizNo: '   ' } }))
  assert.deepEqual(missingSupplierFields(doc), ['bizNo'])
})
