// 견적서 엑셀 — **고객이 열어 읽고 결재하는 파일**이라 화면보다 되돌리기 어렵다
//
// 여기서 확인하는 것은 «셀에 무엇이 들어갔나»가 아니라
// «화면에 있는 것이 파일에도 있나»와 «인쇄했을 때 문서로 보이나»다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { QUOTE } from '../../terms/quote.ts'
import ExcelJS from 'exceljs'
import { quoteDocumentToXlsx } from './quote-xlsx.ts'
import { buildQuoteDocument, type BuildQuoteDocumentInput } from '../domain/quote-document.ts'

function doc(over: Partial<BuildQuoteDocumentInput> = {}) {
  const base: BuildQuoteDocumentInput = {
    quote: {
      quoteNo: 'Q-2026-0014', title: 'GPU 인프라 구축 견적', currency: 'KRW',
      validUntil: '2026-09-27', createdAt: '2026-08-27T00:00:00.000Z',
      subtotalMinor: BigInt(510000000), discountMinor: BigInt(18750000),
      taxMinor: BigInt(49125000), totalMinor: BigInt(540375000),
      notesMd: '상기 금액은 부가세 별도입니다.',
    },
    lines: [
      { name: 'NVIDIA H100 80GB', descriptionMd: 'SXM5 · 3년 무상보증 포함', unit: '대', quantity: '8', unitPriceMinor: BigInt(45000000), discountPercent: '0', lineTotalMinor: BigInt(360000000) },
      { name: '구축 및 최적화 용역', descriptionMd: null, unit: '개월', quantity: '12', unitPriceMinor: BigInt(12500000), discountPercent: '12.5', lineTotalMinor: BigInt(131250000) },
    ],
    customer: { companyName: '한국지능정보사회진흥원', personName: '이준희 팀장', fallbackName: '딜' },
    supplier: {
      name: '주식회사 데이터얼라이언스', bizNo: '123-45-67890', ceo: '김도현',
      address: '서울 강남구', bizType: '서비스업', bizItem: '소프트웨어',
      contact: '02-1234-5678', terms: '결제: 30일\n납품: 8주',
    },
    todayKey: '2026-08-27',
  }
  return buildQuoteDocument({ ...base, ...over })
}

/** 시트의 모든 셀 값을 한 문자열로 — 「이 말이 파일에 있나」를 보기 위해 */
async function textOf(buffer: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as unknown as ArrayBuffer)
  const ws = wb.worksheets[0]
  const out: string[] = []
  ws.eachRow((row) => row.eachCell({ includeEmpty: false }, (c) => out.push(String(c.value ?? ''))))
  return out.join('\n')
}

async function sheetOf(buffer: Buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as unknown as ArrayBuffer)
  return { wb, ws: wb.worksheets[0] }
}

test('진짜 xlsx 파일이다 — zip 서명으로 시작한다', async () => {
  const out = await quoteDocumentToXlsx({ document: doc() })
  assert.equal(out.buffer.subarray(0, 2).toString('hex'), '504b', 'xlsx 가 아니다')
  assert.equal(out.filename, 'Q-2026-0014_견적서.xlsx')
})

test('화면에 있는 것이 파일에도 있다 — 담당자까지', async () => {
  const text = await textOf((await quoteDocumentToXlsx({ document: doc() })).buffer)
  for (const must of [
    // 제목은 자간 표기라 「견 적 서」다 — 엑셀엔 letter-spacing 이 없어 공백으로 만든다
    '견 적 서', 'Q-2026-0014', '2026-09-27',
    '한국지능정보사회진흥원 귀중',
    // 인쇄본에는 나오는데 엑셀에만 빠졌던 값 — 빠지면 같은 문서가 아니다
    '이준희 팀장',
    // 무엇에 대한 견적인지. 화면에 있는데 파일에 없으면 같은 문서가 아니다.
    // **말은 상수에서 가져온다** — 여기 글자를 박아 두면 용어를 고칠 때 가드가 막는다
    // (실제로 「건명」→「사업명」으로 바꿀 때 이 줄이 실패했다).
    QUOTE.subject, 'GPU 인프라 구축 견적',
    '주식회사 데이터얼라이언스', '123-45-67890', '김도현',
    'NVIDIA H100 80GB', 'SXM5 · 3년 무상보증 포함', '구축 및 최적화 용역',
    '공급가액', '할인', '부가세', '합계 금액',
    '금 오억사천삼십칠만오천원정',
    '결제: 30일', '납품: 8주', '상기 금액은 부가세 별도입니다.',
  ]) assert.ok(text.includes(must), `«${must}» 가 엑셀에 없다`)
})

test('금액은 계산할 수 있는 숫자다 — 문자열로 넣으면 엑셀에서 못 더한다', async () => {
  const { ws } = await sheetOf((await quoteDocumentToXlsx({ document: doc() })).buffer)
  const nums: number[] = []
  ws.eachRow((row) => row.eachCell({ includeEmpty: false }, (c) => {
    if (typeof c.value === 'number') nums.push(c.value)
  }))
  assert.ok(nums.includes(540375000), '합계가 숫자로 안 들어갔다')
  assert.ok(nums.includes(45000000), '단가가 숫자로 안 들어갔다')
})

test('문서 어디에도 통화 코드를 쓰지 않는다 — 「통화 KRW」라고 적는 곳은 없다', async () => {
  const text = await textOf((await quoteDocumentToXlsx({ document: doc() })).buffer)
  assert.ok(!text.includes('KRW'), 'KRW 가 셀에 찍혔다')
  assert.ok(!text.includes('통화'), '통화 줄이 남아 있다')
})

test('원화는 서식으로 「원」을 붙인다 — 값은 숫자로 남아 받은 사람이 더할 수 있다', async () => {
  const { ws } = await sheetOf((await quoteDocumentToXlsx({ document: doc() })).buffer)
  const fmts = new Set<string>()
  ws.eachRow((row) => row.eachCell({ includeEmpty: false }, (c) => { if (c.numFmt) fmts.add(c.numFmt) }))
  assert.ok(fmts.has('#,##0"원"'), `원화 서식이 없다 — ${Array.from(fmts).join(',')}`)
  // 「KRW」 라고 쓰는 곳은 한국 문서에 없다
  assert.ok(!Array.from(fmts).some((f) => f.includes('KRW')), '엑셀만 KRW 라고 말한다')
})

test('달러는 기호를 앞에 — 화면과 같은 SSOT 를 쓴다', async () => {
  const usd = doc({ quote: { ...doc().meta, quoteNo: 'Q-1', title: 't', currency: 'USD', validUntil: null, createdAt: '2026-08-27T00:00:00.000Z', subtotalMinor: BigInt(12000000), discountMinor: BigInt(0), taxMinor: BigInt(0), totalMinor: BigInt(12000000), notesMd: null } as never })
  const { ws } = await sheetOf((await quoteDocumentToXlsx({ document: usd })).buffer)
  const fmts = new Set<string>()
  ws.eachRow((row) => row.eachCell({ includeEmpty: false }, (c) => { if (c.numFmt) fmts.add(c.numFmt) }))
  assert.ok(fmts.has('"$"#,##0.00'), `USD 서식이 없다 — ${Array.from(fmts).join(',')}`)
})

test('A4 세로, 가로는 한 장에 맞춘다 — 금액 열이 다음 장으로 넘어가면 못 읽는다', async () => {
  const { ws } = await sheetOf((await quoteDocumentToXlsx({ document: doc() })).buffer)
  assert.equal(ws.pageSetup.paperSize, 9, 'A4 가 아니다')
  assert.equal(ws.pageSetup.orientation, 'portrait')
  assert.equal(ws.pageSetup.fitToWidth, 1, '가로를 한 장에 안 맞춘다')
  assert.equal(ws.pageSetup.fitToHeight, 0, '세로까지 한 장에 밀어 넣으면 글씨가 못 읽게 작아진다')
})

test('인쇄 영역이 실제로 쓴 마지막 행까지다 — 빈 행이 붙으면 백지가 한 장 더 나온다', async () => {
  const { ws } = await sheetOf((await quoteDocumentToXlsx({ document: doc() })).buffer)
  const area = String(ws.pageSetup.printArea ?? '')
  assert.match(area, /^A1:G\d+$/, `인쇄 영역이 이상하다 — ${area}`)
  const last = Number(area.split(':G')[1])
  assert.equal(last, ws.rowCount, `인쇄 영역(${last})이 실제 마지막 행(${ws.rowCount})과 다르다`)
})

test('눈금선을 끈다 — 격자가 보이면 「문서」가 아니라 「스프레드시트」로 읽힌다', async () => {
  const { ws } = await sheetOf((await quoteDocumentToXlsx({ document: doc() })).buffer)
  assert.equal(ws.views[0]?.showGridLines, false, '격자가 살아 있다')
})

test('항목이 여러 장으로 넘어가면 표 머리글을 매 장에 다시 찍는다', async () => {
  const many = doc({
    lines: Array.from({ length: 60 }, (_, i) => ({
      name: `품목 ${i + 1}`, quantity: '1', unitPriceMinor: BigInt(1000), lineTotalMinor: BigInt(1000),
    })),
    quote: { ...doc().meta, quoteNo: 'Q-1', title: 't', currency: 'KRW', validUntil: null, createdAt: '2026-08-27T00:00:00.000Z', subtotalMinor: BigInt(60000), discountMinor: BigInt(0), taxMinor: BigInt(6000), totalMinor: BigInt(66000), notesMd: null } as never,
  })
  const { ws } = await sheetOf((await quoteDocumentToXlsx({ document: many })).buffer)
  assert.match(String(ws.pageSetup.printTitlesRow ?? ''), /^\d+:\d+$/, '반복 머리글이 없다')
})

test('원가·마진은 담길 자리가 없다 — 고객에게 가는 파일이다', async () => {
  const text = await textOf((await quoteDocumentToXlsx({
    document: doc({ lines: [{ name: 'X', quantity: 1, unitPriceMinor: 100, lineTotalMinor: 100, costMinor: BigInt(70), marginPct: 30 } as never] }),
  })).buffer)
  assert.ok(!text.includes('원가'))
  assert.ok(!text.includes('마진'))
  assert.ok(!/\b70\b/.test(text), '원가 값이 새어 나갔다')
})

test('비어 있는 공급자 항목은 줄을 만들지 않는다', async () => {
  const text = await textOf((await quoteDocumentToXlsx({
    document: doc({ supplier: { name: '우리회사' } }),
  })).buffer)
  assert.ok(text.includes('우리회사'))
  assert.ok(!text.includes('사업자등록번호'), '빈 항목이 라벨만 남았다')
})

test('로고를 넣으면 이미지가 실린다', async () => {
  // 1x1 PNG
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const out = await quoteDocumentToXlsx({ document: doc(), logo: png })
  const { wb } = await sheetOf(out.buffer)
  assert.equal(wb.model.media?.length, 1, '로고가 안 실렸다')
})

test('날인은 이미지가 아니라 「(직인생략)」 문구다 — 도장을 박으면 받은 사람이 오려 쓴다', async () => {
  const out = await quoteDocumentToXlsx({ document: doc() })
  const { wb } = await sheetOf(out.buffer)
  assert.equal(wb.model.media?.length ?? 0, 0, '이미지가 실렸다')
  assert.ok((await textOf(out.buffer)).includes('(직인생략)'), '날인 문구가 없다')
})

test('SVG 처럼 못 받는 형식은 조용히 무시한다 — 파일 생성이 통째로 죽으면 안 된다', async () => {
  const out = await quoteDocumentToXlsx({
    document: doc(), logo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  })
  const { wb } = await sheetOf(out.buffer)
  assert.equal(wb.model.media?.length ?? 0, 0)
  // 그래도 문서는 나온다
  assert.ok((await textOf(out.buffer)).includes('Q-2026-0014'))
})

test('항목이 0건이어도 파일은 만들어진다', async () => {
  const empty = doc({
    lines: [],
    quote: { ...doc().meta, quoteNo: 'Q-0', title: 't', currency: 'KRW', validUntil: null, createdAt: '2026-08-27T00:00:00.000Z', subtotalMinor: BigInt(0), discountMinor: BigInt(0), taxMinor: BigInt(0), totalMinor: BigInt(0), notesMd: null } as never,
  })
  const text = await textOf((await quoteDocumentToXlsx({ document: empty })).buffer)
  assert.ok(text.includes('품목'), '표 머리글이 없다')
})
