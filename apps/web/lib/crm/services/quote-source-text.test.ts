/**
 * 문서 → 글 옮기기 가드
 *
 * **여기서 틀리면 견적 금액이 틀린다.** 표의 셀 경계가 사라지면 수량과 단가가
 * 한 줄에 뒤섞이고, 그걸 읽은 모델이 둘을 바꿔 넣는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { irToSourceText, tableToLines, MAX_SOURCE_CHARS } from './quote-source-text.ts'
import type { IrDocument, IrBlock, IrTable, IrFigure } from '../../rfp/ir/types.ts'

function block(over: Partial<IrBlock> & { blockId: string; orderNo: number }): IrBlock {
  return {
    type: 'paragraph', text: '', html: null, pageNo: 1, bbox: null,
    sectionId: null, sourceRef: { kind: 'text', paraIdx: over.orderNo },
    textHash: '', ocrConfidence: null,
    ...over,
  }
}

function doc(over: Partial<IrDocument> = {}): IrDocument {
  return {
    meta: {
      fileRole: 'quote', format: 'pdf', pageCount: 1,
      parser: 'officeparser', parserVersion: '7.3.0', qualityScore: 90, warnings: [],
    },
    pages: [], sections: [], blocks: [], tables: [], figures: [],
    ...over,
  }
}

function table(over: Partial<IrTable> & { blockId: string }): IrTable {
  return { tableId: 't1', rows: 0, cols: 0, cells: [], caption: null, ...over }
}

/* ── 표 ─────────────────────────────────────────── */

test('★ 2행 3열 표가 행마다 한 줄, 셀은 | 로 갈린다 — 평문으로 뭉개면 수량과 단가가 섞인다', () => {
  const t = table({
    blockId: 'b1', rows: 2, cols: 3,
    cells: [
      { r: 0, c: 0, rowspan: 1, colspan: 1, text: '품목' },
      { r: 0, c: 1, rowspan: 1, colspan: 1, text: '수량' },
      { r: 0, c: 2, rowspan: 1, colspan: 1, text: '단가' },
      { r: 1, c: 0, rowspan: 1, colspan: 1, text: 'H100 SXM' },
      { r: 1, c: 1, rowspan: 1, colspan: 1, text: '2' },
      { r: 1, c: 2, rowspan: 1, colspan: 1, text: '50,000,000' },
    ],
  })
  assert.deepEqual(tableToLines(t), [
    '품목 | 수량 | 단가',
    'H100 SXM | 2 | 50,000,000',
  ])
})

test('★ 병합 셀은 왼쪽 위에만 — 칸마다 복사하면 「소계」가 네 번 나와 항목 넷으로 읽힌다', () => {
  const t = table({
    blockId: 'b1', rows: 1, cols: 3,
    cells: [{ r: 0, c: 0, rowspan: 1, colspan: 3, text: '소계' }],
  })
  assert.deepEqual(tableToLines(t), ['소계 |  |'])
})

test('빈 행은 버린다 — 「 |  | 」는 읽는 쪽에 아무 뜻도 안 준다', () => {
  const t = table({
    blockId: 'b1', rows: 2, cols: 2,
    cells: [{ r: 1, c: 0, rowspan: 1, colspan: 1, text: '합계' }],
  })
  assert.deepEqual(tableToLines(t), ['합계 |'])
})

test('셀이 격자 밖을 가리키면 버린다 — 넣으면 배열 밖 접근으로 통째로 죽는다', () => {
  const t = table({
    blockId: 'b1', rows: 1, cols: 1,
    cells: [
      { r: 0, c: 0, rowspan: 1, colspan: 1, text: '가' },
      { r: 9, c: 9, rowspan: 1, colspan: 1, text: '밖' },
    ],
  })
  assert.deepEqual(tableToLines(t), ['가'])
})

test('★ 표 블록의 셀을 못 찾으면 평문이라도 남긴다 — 버리면 그 표가 없던 것이 된다', () => {
  const d = doc({
    blocks: [block({ blockId: 'b1', orderNo: 0, type: 'table', text: 'H100 2 5000만' })],
    tables: [],
  })
  const r = irToSourceText(d)
  assert.equal(r.text, 'H100 2 5000만')
  assert.equal(r.tableCount, 0, '못 편 표를 센 것으로 치면 화면이 「표로 읽었다」고 거짓말한다')
})

/* ── 머리말·꼬리말 ───────────────────────────────── */

test('★ 머리말·꼬리말은 뺀다 — 쪽마다 반복돼 항목 줄로 읽힌다', () => {
  const d = doc({
    blocks: [
      block({ blockId: 'h', orderNo: 0, type: 'header', text: '주식회사 데이터얼라이언스' }),
      block({ blockId: 'p', orderNo: 1, text: 'H100 견적' }),
      block({ blockId: 'f', orderNo: 2, type: 'footer', text: '- 1 -' }),
    ],
  })
  assert.equal(irToSourceText(d).text, 'H100 견적')
})

/* ── 순서 ───────────────────────────────────────── */

test('★ orderNo 로 정렬한다 — 안 하면 합계가 항목보다 먼저 나오는 글이 된다', () => {
  const d = doc({
    blocks: [
      block({ blockId: 'b2', orderNo: 5, text: '합계 1억' }),
      block({ blockId: 'b1', orderNo: 1, text: 'H100 2대' }),
    ],
  })
  assert.equal(irToSourceText(d).text, 'H100 2대\n합계 1억')
})

/* ── 종류별 표시 ─────────────────────────────────── */

test('제목과 목록은 표시를 달고 나온다 — 모델이 구조를 볼 수 있어야 한다', () => {
  const d = doc({
    blocks: [
      block({ blockId: 'b1', orderNo: 0, type: 'heading', text: '1. 하드웨어' }),
      block({ blockId: 'b2', orderNo: 1, type: 'list_item', text: '3년 무상보증' }),
    ],
  })
  assert.equal(irToSourceText(d).text, '## 1. 하드웨어\n- 3년 무상보증')
})

test('그림 안에서 뽑은 글자를 쓴다 — 표를 그림으로 붙여 넣은 견적서가 실제로 있다', () => {
  const fig: IrFigure = { figureId: 'f1', blockId: 'b1', imageRef: null, extractedText: 'GPU | 4 | 3000만' }
  const d = doc({
    blocks: [block({ blockId: 'b1', orderNo: 0, type: 'figure', text: '' })],
    figures: [fig],
  })
  assert.equal(irToSourceText(d).text, 'GPU | 4 | 3000만')
})

/* ── 상한 ───────────────────────────────────────── */

test('★ 상한을 넘으면 잘랐다고 말한다 — 조용히 버리면 화면이 12건을 전부라고 말한다', () => {
  const blocks = Array.from({ length: 50 }, (_, i) =>
    block({ blockId: `b${i}`, orderNo: i, text: '가'.repeat(20) }))
  const r = irToSourceText(doc({ blocks }), { maxChars: 100 })
  assert.equal(r.truncated, true)
  assert.ok(r.text.length <= 100, `상한을 넘겼다 (${r.text.length})`)
})

test('상한 안이면 안 잘랐다고 말한다', () => {
  const d = doc({ blocks: [block({ blockId: 'b1', orderNo: 0, text: '짧다' })] })
  assert.equal(irToSourceText(d).truncated, false)
})

test('★ 줄 경계에서 끊는다 — 글자 수로 자르면 마지막 줄이 반쪽 표가 되어 온전한 항목으로 읽힌다', () => {
  const d = doc({
    blocks: [
      block({ blockId: 'b1', orderNo: 0, text: 'AAAAA' }),
      block({ blockId: 'b2', orderNo: 1, text: 'BBBBBBBBBB' }),
    ],
  })
  const r = irToSourceText(d, { maxChars: 8 })
  assert.equal(r.text, 'AAAAA', '반쪽 줄이 남았다')
  assert.equal(r.truncated, true)
})

test('기본 상한은 견적서 한 벌이 들어갈 크기다', () => {
  assert.ok(MAX_SOURCE_CHARS >= 10_000, '부속명세가 붙은 견적서가 통째로 잘린다')
})

/* ── 표 개수 ─────────────────────────────────────── */

test('★ 편 표의 개수를 센다 — 0 이면 견적서를 표로 못 읽은 것이고 화면이 그 사실을 말해야 한다', () => {
  const d = doc({
    blocks: [
      block({ blockId: 'b1', orderNo: 0, type: 'table', text: '' }),
      block({ blockId: 'b2', orderNo: 1, type: 'table', text: '' }),
    ],
    tables: [
      table({ blockId: 'b1', tableId: 't1', rows: 1, cols: 1, cells: [{ r: 0, c: 0, rowspan: 1, colspan: 1, text: '가' }] }),
      table({ blockId: 'b2', tableId: 't2', rows: 1, cols: 1, cells: [{ r: 0, c: 0, rowspan: 1, colspan: 1, text: '나' }] }),
    ],
  })
  assert.equal(irToSourceText(d).tableCount, 2)
})
