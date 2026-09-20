/**
 * 문서 → 글 옮기기 가드
 *
 * **여기서 틀리면 견적 금액이 틀린다.** 표의 셀 경계가 사라지면 수량과 단가가
 * 한 줄에 뒤섞이고, 그걸 읽은 모델이 둘을 바꿔 넣는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  irToSourceText, tableToLines, MAX_SOURCE_CHARS, pageMarkLine, pageOfMarkLine,
} from './quote-source-text.ts'
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

/* ── 글자 파일도 표로 들어온다 (v0.10.18x) ─────────── */

/*
  **왜 여기서 또 보나**: 파서가 표를 만들어도 이 변환이 그것을 표로 쓰지 않으면
  견적 인입에는 아무 변화가 없다. 실제로 마크다운 견적서가 「표를 찾지 못해 글줄만
  읽었어요」라는 안내와 함께 들어오고 있었다(실측 2026-09-20). 파서와 이 자리를
  함께 밟아야 그 경로가 이어진 것이다.
*/
test('★ 마크다운 견적서가 표로 들어온다 — 구분줄은 글에 안 실린다', async () => {
  const { parsePlain } = await import('../../rfp/parse/plain.ts')
  const md = [
    '견적서',
    '',
    '| 품명 | 수량 | 단가 |',
    '| --- | --- | --- |',
    '| H100 SXM 8way | 2 | 100,000,000 |',
    '| 설치 및 셋업 | 1 | 10,000,000 |',
    '',
    '공급가 합계: 210,000,000 원',
  ].join('\n')

  const parsed = parsePlain(new TextEncoder().encode(md), { fileId: 'f1', fileName: '견적서.md' })
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return

  const out = irToSourceText(parsed.doc)
  assert.ok(out.tableCount >= 1, '표로 안 들어왔다 — 화면이 「표를 찾지 못해」라고 말하게 된다')
  assert.match(out.text, /품명 \| 수량 \| 단가/, '표가 행 단위로 안 들어왔다')
  assert.match(out.text, /H100 SXM 8way \| 2 \| 100,000,000/)
  assert.ok(!/---/.test(out.text), '구분줄이 원문 조각으로 들어갔다')
  // 표 앞뒤 글도 순서를 지켜 남는다 — 합계가 없으면 대조할 것이 사라진다
  assert.ok(out.text.indexOf('견적서') < out.text.indexOf('품명'))
  assert.match(out.text, /공급가 합계: 210,000,000/)
})

test('★ CSV 견적서도 표로 들어온다', async () => {
  const { parsePlain } = await import('../../rfp/parse/plain.ts')
  const csv = '품명,수량,단가\nL40S,4,12000000\n유지보수,12,500000\n'
  const parsed = parsePlain(new TextEncoder().encode(csv), { fileId: 'f2', fileName: '견적서.csv' })
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const out = irToSourceText(parsed.doc)
  assert.equal(out.tableCount, 1)
  assert.match(out.text, /L40S \| 4 \| 12000000/)
})

/* ── 쪽 표시 (v0.10.304) ─────────────────────────── */

/*
  **왜 쪽을 심나**: 읽고 나서 「어느 쪽에서 왔나」를 되찾을 길이 여기밖에 없다.
  한 파일에 견적이 둘이면 그 둘은 다른 쪽에 있고, 쪽을 모르면 견적마다 원본 조각을
  붙일 수도 대조를 그 쪽에서 열 수도 없다.
*/

test('★ 쪽이 바뀌는 자리에만 표시 줄이 붙는다 — 줄마다 붙이면 글자만 먹는다', () => {
  const d = doc({
    blocks: [
      block({ blockId: 'b1', orderNo: 0, pageNo: 1, text: '견적서' }),
      block({ blockId: 'b2', orderNo: 1, pageNo: 2, text: 'H100 | 2 | 5000만' }),
      block({ blockId: 'b3', orderNo: 2, pageNo: 2, text: 'RAM | 8 | 2000만' }),
      block({ blockId: 'b4', orderNo: 3, pageNo: 3, text: '합계 | 7000만' }),
    ],
  })
  const r = irToSourceText(d)
  assert.deepEqual(r.text.split('\n'), [
    pageMarkLine(1),
    '견적서',
    pageMarkLine(2),
    'H100 | 2 | 5000만',
    'RAM | 8 | 2000만',
    pageMarkLine(3),
    '합계 | 7000만',
  ])
  assert.deepEqual(r.pages, [1, 2, 3])
})

test('★ 쪽이 하나뿐인 문서에는 표시 줄을 안 넣는다 — 그래도 pages 로 그 쪽을 안다', () => {
  const d = doc({
    blocks: [
      block({ blockId: 'b1', orderNo: 0, pageNo: 1, text: 'H100 | 2 | 5000만' }),
      block({ blockId: 'b2', orderNo: 1, pageNo: 1, text: '합계 | 1억' }),
    ],
  })
  const r = irToSourceText(d)
  assert.equal(r.text, 'H100 | 2 | 5000만\n합계 | 1억', '표시 줄이 끼어들었다')
  assert.deepEqual(r.pages, [1], '한 쪽짜리도 그 쪽이 몇 쪽인지는 말해야 한다')
})

test('★ 쪽을 모르는 파서(평문·한글)는 표시 줄이 0 개다 — 그 경로가 안 깨져야 한다', () => {
  const d = doc({
    blocks: [
      block({ blockId: 'b1', orderNo: 0, pageNo: null, text: 'H100 | 2 | 5000만' }),
      block({ blockId: 'b2', orderNo: 1, pageNo: null, text: '합계 | 1억' }),
    ],
  })
  const r = irToSourceText(d)
  // 빈 배열만 보면 서명이 틀려도 초록이다 — 글이 그대로 나왔는지도 같이 본다
  assert.equal(r.text, 'H100 | 2 | 5000만\n합계 | 1억')
  assert.deepEqual(r.pages, [])
})

test('쪽이 비어 있는 블록은 앞 줄의 쪽을 물려받는다 — 표 한가운데서 근거가 끊기면 안 된다', () => {
  const d = doc({
    blocks: [
      block({ blockId: 'b1', orderNo: 0, pageNo: 2, text: 'H100 | 2' }),
      block({ blockId: 'b2', orderNo: 1, pageNo: null, text: 'RAM | 8' }),
      block({ blockId: 'b3', orderNo: 2, pageNo: 3, text: '합계' }),
    ],
  })
  const r = irToSourceText(d)
  assert.deepEqual(r.pages, [2, 3], '쪽 모름 블록이 쪽을 끊었다')
})

test('★ 표시 줄도 상한에 든다 — 안 세면 넘긴 글이 상한을 넘는다', () => {
  const d = doc({
    blocks: [
      block({ blockId: 'b1', orderNo: 0, pageNo: 1, text: 'AAAA' }),
      block({ blockId: 'b2', orderNo: 1, pageNo: 2, text: 'BBBB' }),
    ],
  })
  const mark = pageMarkLine(1)
  // 표시 줄 + 첫 줄까지만 드는 상한
  const r = irToSourceText(d, { maxChars: mark.length + 1 + 'AAAA'.length + 1 })
  assert.equal(r.text, `${mark}\nAAAA`)
  assert.equal(r.truncated, true)
  assert.deepEqual(r.pages, [1], '잘려 나간 2쪽을 「읽었다」고 세면 안 읽은 쪽에 조각이 붙는다')
})

test('표시 줄에서 쪽 번호를 되읽는다 — 되읽을 수 없으면 모델 답을 검산할 길이 없다', () => {
  assert.equal(pageOfMarkLine(pageMarkLine(12)), 12)
  assert.equal(pageOfMarkLine('  --- 3쪽 ---  '), 3)
  assert.equal(pageOfMarkLine('H100 | 2 | 5000만'), null)
  assert.equal(pageOfMarkLine('--- 3쪽'), null)
})
