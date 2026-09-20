/**
 * 구성이 다시 사라지지 않게 — **그 견적서 한 장을 붙박이로 둔다**
 *
 * ## 무엇을 재현하나
 *
 * 2026-09-20, 한국산업기술시험원 광양분소 견적서(2쪽)를 올렸더니 원본 표 20줄 가운데
 * **6줄만** 들어왔다. 사라진 14줄은 섀시 구성 13줄과 금액 칸이 빈 워런티 1줄이다.
 * 금액은 한 자리도 안 틀렸다 — 틀린 것은 «그 금액이 무엇으로 이루어졌는지»였다.
 *
 * ## 무엇을 붙잡을 수 있나
 *
 * 모델이 무엇을 답할지는 시험이 못 정한다. 그래서 **모델 앞뒤 두 자리**를 붙잡는다:
 *
 *   ① 우리가 모델에게 **무엇을 넘기나** — 표 20줄이 한 줄도 안 빠지고 넘어가나
 *   ② 모델이 그 문서를 옳게 답했을 때 **우리가 그걸 온전히 받나** — 항목 7·구성 13·
 *      금액 없는 줄 1 이 그대로 살아남나
 *
 * 둘 중 하나라도 깨지면 구성은 다시 사라진다. 실제로 깨져 있던 것은 ②였다
 * (담을 자리가 없어 스키마가 버렸다).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { irToSourceText, pageMarkLine } from './quote-source-text.ts'
import { parseQuoteFromDocDoc } from '../ai/schemas/quote-from-doc.ts'
import { joinSpec, splitSpec } from '../domain/quote-spec.ts'
import type { IrDocument, IrBlock, IrTable } from '../../rfp/ir/types.ts'

/* ── 원본 표 (실제 그 문서의 모양) ──────────────── */

/** 섀시 밑에 이어지던 구성 열세 줄 — 품목 칸이 비어 있다 */
const CHASSIS_COMPONENTS = [
  'Rack Server - AMD EPYC 9005/9004 Server Processors - 2U DP 24+4-Bay Gen5 NVMe/SATA/SAS-4 (24 x NVMe) Titanium',
  'Dual AMD EPYC 9005/9004 Server Processors',
  '12-Channel DDR5 RDIMM per CPU with 24 x DIMMs',
  '2 x 1 Gb/s LAN ports via Intel i350-AM2',
  '24 x 2.5" Gen5 NVMe hot-swap bays',
  '4 x 2.5" SATA/SAS-4 hot swap bays on the rear side',
  '(SAS card is required to support SAS drives)',
  '2 x M.2 slots with PCIe Gen3 x4 and x2',
  '1 x FHHL PCIe x16 slot with Gen5 x16 lanes',
  '1 x OCP NIC 3.0 PCIe Gen5 x16 slot',
  'Compatible with SupremeRAID by Graid Technology',
  'Dual 2000 W 80 PLUS Titanium redundant power supplies',
  'Dimensions (W x H x D, mm) : 2U (438 x 87.5 x 815)',
]

/** 원본 상세내역 스무 줄 — 품목이 적힌 일곱 줄과 구성 열세 줄 */
const ROWS: string[][] = [
  ['GIGABYTE R283-Z96-AAJ1', 'AMD 9355 3.55GHz/32Core x 2Ea, 256GB Mem, 7.68TB U.2 NVMe x 22Ea', '1', '6,050,000'],
  ...CHASSIS_COMPONENTS.map((c) => ['', c, '', '']),
  ['CPU', 'AMD EPYC 9355 (32C/64T, 3.55~4.4GHz, 256MB, 280W)', '2', '12,342,000'],
  ['RAM', 'DDR5-5600 ECC/REG 32GB', '8', '22,264,000'],
  ['SSD', '7.68TB Enterprise U.2 NVMe', '22', '127,776,000'],
  ['NIC1', 'BCM957508-N2 100Gb QSFP56 2Port OCP 3.0', '1', '2,178,000'],
  ['RAID', 'SupremeRAID NVMe RAID Card', '1', '7,018,000'],
  // **금액 칸이 비어 있다.** 이 줄이 빠져서 보증 조건이 우리 견적서에서 사라졌다
  ['워런티', '서버섀시/GPU/PSU 3년 & CPU/Memory 1년', '1', ''],
]

function goldenDoc(): IrDocument {
  const table: IrTable = {
    tableId: 't1', blockId: 'b-table', rows: ROWS.length, cols: 4, caption: null,
    cells: ROWS.flatMap((row, r) =>
      row.map((text, c) => ({ r, c, rowspan: 1, colspan: 1, text }))),
  }
  const block = (over: Partial<IrBlock> & { blockId: string; orderNo: number }): IrBlock => ({
    type: 'paragraph', text: '', html: null, pageNo: 1, bbox: null, sectionId: null,
    sourceRef: { kind: 'pdf', pageIdx: 0, charStart: 0, charEnd: 0 },
    textHash: '', ocrConfidence: null, ...over,
  })
  return {
    meta: {
      fileRole: 'quote', format: 'pdf', pageCount: 2,
      parser: 'officeparser', parserVersion: '7.3.0', qualityScore: 90, warnings: [],
    },
    pages: [], sections: [], figures: [],
    blocks: [
      block({ blockId: 'b-head', orderNo: 0, pageNo: 1, text: '견 적 서' }),
      // 표는 2쪽에 있다 — 대조 화면이 그 쪽을 열려면 이 값이 살아 있어야 한다
      block({ blockId: 'b-table', orderNo: 1, pageNo: 2, type: 'table' }),
    ],
    tables: [table],
  }
}

/* ── ① 모델에게 넘기는 글 ───────────────────────── */

test('★ 원본 표 스무 줄이 한 줄도 안 빠지고 넘어간다', () => {
  const read = irToSourceText(goldenDoc())
  const lines = read.text.split('\n')

  for (const row of ROWS) {
    const head = row.find(Boolean) ?? ''
    assert.ok(lines.some((l) => l.includes(head)), `원문에서 사라진 줄: ${head}`)
  }
  assert.equal(read.tableCount, 1, '표로 안 읽혔다 — 셀 경계가 사라지면 수량과 단가가 섞인다')
})

test('★ 구성 열세 줄이 원문에 그대로 있다 — 여기서 빠지면 모델은 볼 수조차 없다', () => {
  const text = irToSourceText(goldenDoc()).text
  const kept = CHASSIS_COMPONENTS.filter((c) => text.includes(c))
  assert.equal(kept.length, 13, `구성 ${13 - kept.length}줄이 원문에서 사라졌다`)
})

test('★ 표가 2쪽에 있다는 사실이 글에 남는다 — 없으면 대조가 늘 1쪽부터 열린다', () => {
  const read = irToSourceText(goldenDoc())
  assert.ok(read.text.includes(pageMarkLine(2)), '쪽 표시가 없다')
  assert.deepEqual(read.pages, [1, 2])
})

/* ── ② 모델 답을 우리가 받는 자리 ───────────────── */

/** 모델이 이 문서를 옳게 읽었을 때의 답 */
const ANSWER = JSON.stringify({
  quotes: [{
    label: null, title: '한국산업기술시험원 광양분소 고속통합 스토리지 서버',
    currency: 'KRW', customerName: '한국산업기술시험원 광양분소', supplierName: '데이터얼라이언스 주식회사',
    issuedOn: '2026-07-27', pageStart: 2, pageEnd: 2,
    sourceTotalMinor: 177628000, sourceTotalIncludesTax: false, taxPercent: 10,
    lines: [
      {
        name: 'GIGABYTE R283-Z96-AAJ1', spec: 'AMD 9355 3.55GHz/32Core x 2Ea, 256GB Mem',
        components: CHASSIS_COMPONENTS,
        kind: 'QUANTITY', quantity: 1, unit: '대', unitPriceMinor: 6050000,
        discountPercent: null, specialDiscountPercent: null, amountMinor: 6050000,
        sourcePage: 2, groupLabel: null, sourceText: 'GIGABYTE R283-Z96-AAJ1 | ... | 1 | 6,050,000',
      },
      ...[
        ['CPU', 2, 12342000], ['RAM', 8, 22264000], ['SSD', 22, 127776000],
        ['NIC1', 1, 2178000], ['RAID', 1, 7018000],
      ].map(([name, qty, amount]) => ({
        name, spec: null, components: [], kind: 'QUANTITY', quantity: qty, unit: '개',
        unitPriceMinor: null, discountPercent: null, specialDiscountPercent: null,
        amountMinor: amount, sourcePage: 2, groupLabel: null, sourceText: `${name} | ${qty} | ${amount}`,
      })),
      {
        name: '워런티', spec: '서버섀시/GPU/PSU 3년 & CPU/Memory 1년', components: [],
        kind: 'FIXED', quantity: 1, unit: '식', unitPriceMinor: null,
        discountPercent: null, specialDiscountPercent: null,
        // **금액이 없다.** 그래도 항목이다 — 빼면 보증 조건이 견적서에서 사라진다
        amountMinor: null, sourcePage: 2, groupLabel: null,
        sourceText: '워런티 | 서버섀시/GPU/PSU 3년 & CPU/Memory 1년 | 1',
      },
    ],
  }],
  unclear: [],
})

test('★ 항목 일곱이 그대로 들어온다 — 예전엔 여섯이었고 워런티가 빠졌다', () => {
  const doc = parseQuoteFromDocDoc(ANSWER)
  const lines = doc.quotes[0].lines
  assert.equal(lines.length, 7)
  assert.ok(lines.some((l) => l.name === '워런티'), '금액 없는 줄이 또 빠졌다')
})

test('★ 구성 열세 줄이 그대로 들어온다 — 이 자리가 없어 13줄이 사라졌다', () => {
  const doc = parseQuoteFromDocDoc(ANSWER)
  assert.equal(doc.quotes[0].lines[0].components.length, 13)
  assert.equal(doc.quotes[0].lines[0].components[1], 'Dual AMD EPYC 9005/9004 Server Processors')
  assert.equal(doc.droppedComponents, 0, '상한에 걸려 잘렸다')
})

test('★ 금액 없는 줄은 0 이 아니라 null 이다 — 0 이면 0원짜리 줄이 견적에 들어간다', () => {
  const doc = parseQuoteFromDocDoc(ANSWER)
  const warranty = doc.quotes[0].lines.find((l) => l.name === '워런티')
  assert.equal(warranty?.amountMinor, null)
})

test('★ 건이 2쪽에서 왔다는 것을 안다 — 두 건짜리 파일에서 자기 건을 가리키는 유일한 값이다', () => {
  const doc = parseQuoteFromDocDoc(ANSWER)
  assert.equal(doc.quotes[0].pageStart, 2)
  assert.equal(doc.quotes[0].lines[0].sourcePage, 2)
})

/* ── ③ 폼과 종이까지 ────────────────────────────── */

test('★ 구성이 폼 값으로 붙고 다시 갈라진다 — 저장·인쇄가 같은 약속을 쓴다', () => {
  const doc = parseQuoteFromDocDoc(ANSWER)
  const line = doc.quotes[0].lines[0]
  const saved = joinSpec(line.spec, line.components)

  assert.equal(saved.split('\n').length, 14, '규격 한 줄 + 구성 열세 줄이 아니다')
  const back = splitSpec(saved)
  assert.equal(back.spec, 'AMD 9355 3.55GHz/32Core x 2Ea, 256GB Mem')
  assert.equal(back.components.length, 13)
})
