// 견적서 CSV — **고객에게 그대로 가는 파일**이라 화면보다 되돌리기 어렵다
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quoteDocumentToCsv } from './quote-document.ts'
import { buildQuoteDocument, type BuildQuoteDocumentInput } from '../domain/quote-document.ts'

function doc(over: Partial<BuildQuoteDocumentInput> = {}) {
  const base: BuildQuoteDocumentInput = {
    quote: {
      quoteNo: 'Q-2026-0014', title: '국책 GPU 인프라 구축 견적', currency: 'KRW',
      validUntil: '2026-09-27', createdAt: '2026-08-27T00:00:00.000Z',
      subtotalMinor: BigInt(510000000), discountMinor: BigInt(18750000),
      taxMinor: BigInt(49125000), totalMinor: BigInt(540375000),
      notesMd: '상기 금액은 부가세 별도입니다.',
    },
    lines: [
      { name: 'NVIDIA H100 80GB', descriptionMd: 'SXM5 · 3년 무상보증 포함', unit: '대', quantity: '8', unitPriceMinor: BigInt(45000000), discountPercent: '0', lineTotalMinor: BigInt(360000000) },
      { name: '구축 및 최적화 용역', descriptionMd: '설치·벤치마크 포함', unit: '개월', quantity: '12', unitPriceMinor: BigInt(12500000), discountPercent: '12.5', lineTotalMinor: BigInt(131250000) },
    ],
    customer: { companyName: '한국지능정보사회진흥원', personName: null, fallbackName: '딜' },
    supplier: {
      name: '주식회사 데이터얼라이언스', bizNo: '123-45-67890', ceo: '김도현',
      address: '서울 강남구', bizType: '서비스업', bizItem: '소프트웨어',
      contact: '02-1234-5678', terms: '결제: 30일\n납품: 8주',
    },
    todayKey: '2026-08-27',
  }
  return buildQuoteDocument({ ...base, ...over })
}

test('엑셀이 UTF-8 로 읽도록 BOM 을 붙인다 — 없으면 한글이 깨진다', () => {
  assert.equal(quoteDocumentToCsv(doc()).csv.charCodeAt(0), 0xFEFF)
})

test('파일명에 견적번호가 들어간다 — 받은 사람이 어느 견적인지 안다', () => {
  assert.equal(quoteDocumentToCsv(doc()).filename, 'Q-2026-0014_견적서.csv')
})

test('금액은 계산 가능한 숫자다 — 천단위 구분을 넣으면 엑셀이 문자열로 읽는다', () => {
  const csv = quoteDocumentToCsv(doc()).csv
  assert.ok(csv.includes('45000000'), '단가가 숫자로 안 실렸다')
  assert.ok(!csv.includes('45,000,000'), '천단위 구분이 들어갔다')
})

test('항목·합계·조건·특기사항이 전부 실린다 — 화면에 있는데 파일에 없으면 안 된다', () => {
  const csv = quoteDocumentToCsv(doc()).csv
  for (const must of [
    'Q-2026-0014', '한국지능정보사회진흥원 귀중', '주식회사 데이터얼라이언스', '123-45-67890',
    'NVIDIA H100 80GB', 'SXM5 · 3년 무상보증 포함', '구축 및 최적화 용역',
    '510000000', '18750000', '49125000', '540375000',
    '금 오억사천삼십칠만오천원정',
    '결제: 30일', '납품: 8주', '상기 금액은 부가세 별도입니다.',
  ]) assert.ok(csv.includes(must), `«${must}» 가 CSV 에 없다`)
})

test('원가·마진은 담길 자리가 없다 — 고객에게 가는 파일이다', () => {
  const csv = quoteDocumentToCsv(doc({
    lines: [{ name: 'X', quantity: 1, unitPriceMinor: 100, lineTotalMinor: 100,
      costMinor: BigInt(70), marginPct: 30 } as never],
  })).csv
  assert.ok(!csv.includes('원가'))
  assert.ok(!csv.includes('마진'))
  assert.ok(!csv.includes('70'), '원가 값이 새어 나갔다')
})

test('쉼표·따옴표·줄바꿈이 든 값은 칸을 넘지 않는다', () => {
  const csv = quoteDocumentToCsv(doc({
    lines: [{ name: 'A100, 80GB "SXM"', quantity: 1, unitPriceMinor: 1, lineTotalMinor: 1 }],
  })).csv
  assert.ok(csv.includes('"A100, 80GB ""SXM"""'), '이스케이프가 안 됐다')
})

test('엑셀에서 수식으로 실행되지 않는다 (CSV 인젝션)', () => {
  // 품목 이름은 사용자가 자유롭게 친다. `=` 로 시작하면 엑셀이 **수식으로 연다** —
  // 열자마자 외부로 데이터를 보내는 공격이 성립한다.
  for (const bad of ['=1+1', '+1', '-1', '@SUM(A1)']) {
    const csv = quoteDocumentToCsv(doc({
      lines: [{ name: bad, quantity: 1, unitPriceMinor: 1, lineTotalMinor: 1 }],
    })).csv
    assert.ok(csv.includes(`'${bad}`) || csv.includes(`"'${bad}"`), `«${bad}» 가 그대로 실렸다`)
  }
})

test('비어 있는 공급자 항목은 줄을 만들지 않는다 — 「—」 가 늘어선 파일을 보내지 않는다', () => {
  const csv = quoteDocumentToCsv(doc({ supplier: { name: '우리회사' } })).csv
  assert.ok(csv.includes('우리회사'))
  assert.ok(!csv.includes('사업자등록번호'), '빈 항목이 라벨만 남았다')
})

test('USD 견적에는 한글 금액 줄이 없다', () => {
  const d = doc()
  const usd = { ...d, meta: { ...d.meta, currency: 'USD' }, totals: { ...d.totals, totalInWords: '' } }
  assert.ok(!quoteDocumentToCsv(usd).csv.includes('금액(한글)'))
})

test('항목이 0건이어도 파일은 만들어진다 — 빈 파일을 주는 것보다 낫다', () => {
  const csv = quoteDocumentToCsv(doc({ lines: [] })).csv
  assert.ok(csv.includes('Q-2026-0014'))
  assert.ok(csv.includes('품목'), '머리글이 없다')
})
