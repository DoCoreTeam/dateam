/**
 * PDF·오피스 파서 어댑터 가드 (설계서 3.3.1)
 *
 * 사상 규칙은 합성 AST 로 검사한다 — 실제 PDF 를 저장소에 넣으면 형식 하나가 늘 때마다
 * 픽스처가 늘고, 그 픽스처가 무엇을 증명하는지 곧 아무도 모르게 된다.
 * 실제 파일 경로는 jspdf 로 그 자리에서 만든 PDF 한 건으로 확인한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  astToIr, blockTypeOf, isPageContainer, isListContainer, needsImageText, sniffOffice,
  parseOfficeDoc, MIN_CHARS_PER_TEXT_PAGE, OFFICE_WARNING, OFFICE_PARSER,
  type AstNode, type AstInput,
} from './office.ts'

const OPTS = { fileId: 'f-1', format: 'pdf' as const }

function ir(content: AstNode[]) {
  return astToIr({ content } as AstInput, OPTS)
}

/** 글자 수만 채운 문단 — 밀도 판정을 시험할 때 쓴다 */
function 문단(n: number, text?: string): AstNode {
  return { type: 'paragraph', text: text ?? '가'.repeat(n) }
}

// ── 노드 사상 ────────────────────────────────────────────────

test('AST 노드 종류가 IR 블록 종류로 사상된다', () => {
  assert.equal(blockTypeOf('heading'), 'heading')
  assert.equal(blockTypeOf('paragraph'), 'paragraph')
  assert.equal(blockTypeOf('table'), 'table')
  assert.equal(blockTypeOf('list'), 'list_item')
  assert.equal(blockTypeOf('image'), 'figure')
  assert.equal(blockTypeOf('header'), 'header')
  assert.equal(blockTypeOf('footer'), 'footer')
  assert.equal(blockTypeOf('note'), 'footnote')
  // 쪽·슬라이드·시트는 담는 자리일 뿐 블록이 아니다
  assert.equal(blockTypeOf('page'), null)
  assert.equal(blockTypeOf('slide'), null)
  assert.equal(blockTypeOf('sheet'), null)
  assert.ok(isPageContainer('page') && isPageContainer('slide') && isPageContainer('sheet'))
  assert.ok(isListContainer('list'))
})

test('모르는 종류는 버리지 않고 문단으로 남긴다', () => {
  // 버리면 근거가 사라지고, 사라진 근거는 「원문에 없음」과 구분되지 않는다
  assert.equal(blockTypeOf('admonition'), 'paragraph')
  const { doc } = ir([{ type: 'admonition', text: '유의사항 준수' }])
  assert.equal(doc.blocks.length, 1)
  assert.equal(doc.blocks[0].type, 'paragraph')
  assert.equal(doc.blocks[0].text, '유의사항 준수')
})

test('제목과 문단이 순서대로 블록이 된다', () => {
  const { doc } = ir([
    { type: 'heading', text: '제1장 사업개요', metadata: { level: 1 } },
    문단(0, '사업기간 12개월'),
  ])
  assert.deepEqual(doc.blocks.map((b) => [b.type, b.text]), [
    ['heading', '제1장 사업개요'],
    ['paragraph', '사업기간 12개월'],
  ])
  assert.deepEqual(doc.blocks.map((b) => b.orderNo), [0, 1])
})

test('같은 글이 두 번 들어가지 않는다', () => {
  // officeparser 는 부모에 text 를, 자식에 같은 text 를 함께 담는다
  const { doc } = ir([
    { type: 'heading', text: '제1장', children: [{ type: 'text', text: '제1장' }] },
  ])
  assert.equal(doc.blocks.length, 1, '부모와 자식이 각각 블록이 됐다')
})

test('목록은 항목마다 한 블록이다', () => {
  const { doc } = ir([{
    type: 'list',
    children: [
      { type: 'paragraph', text: '요구사항 1 성능' },
      { type: 'paragraph', text: '요구사항 2 보안' },
    ],
  }])
  // 통째로 한 블록이면 「몇 번째 요구사항인가」를 못 센다
  assert.deepEqual(doc.blocks.map((b) => b.type), ['list_item', 'list_item'])
  assert.equal(doc.blocks[1].text, '요구사항 2 보안')
})

// ── 표 ───────────────────────────────────────────────────────

test('표는 행과 셀로 펴지고 평문과 HTML 을 함께 남긴다', () => {
  const { doc } = ir([{
    type: 'table',
    metadata: { caption: '요구사항 목록' },
    children: [
      { type: 'row', children: [{ type: 'cell', text: '항목' }, { type: 'cell', text: '내용' }] },
      { type: 'row', children: [{ type: 'cell', text: '기간' }, { type: 'cell', text: '12개월' }] },
    ],
  }])

  assert.equal(doc.tables.length, 1)
  const t = doc.tables[0]
  assert.equal(t.rows, 2)
  assert.equal(t.cols, 2)
  assert.equal(t.cells.length, 4)
  assert.equal(t.caption, '요구사항 목록')
  assert.equal(t.blockId, doc.blocks[0].blockId, '표가 자기 블록을 안 가리킨다')

  const b = doc.blocks[0]
  assert.equal(b.type, 'table')
  assert.equal(b.text, '항목\t내용\n기간\t12개월')
  assert.equal(b.html, '<table><tr><td>항목</td><td>내용</td></tr><tr><td>기간</td><td>12개월</td></tr></table>')
  assert.ok(doc.meta.warnings.includes(OFFICE_WARNING.mergedCellFlattened))
})

test('행 길이가 다른 표도 칸을 채워 사각형이 된다', () => {
  const { doc } = ir([{
    type: 'table',
    children: [
      { type: 'row', children: [{ type: 'cell', text: 'ㄱ' }, { type: 'cell', text: 'ㄴ' }, { type: 'cell', text: 'ㄷ' }] },
      { type: 'row', children: [{ type: 'cell', text: 'ㄹ' }] },
    ],
  }])
  const t = doc.tables[0]
  assert.equal(t.cols, 3)
  assert.equal(t.cells.length, 6, '빈 칸을 안 채우면 셀 좌표가 밀린다')
  assert.equal(t.cells.find((c) => c.r === 1 && c.c === 2)?.text, '')
})

test('HTML 로 남길 때 꺾쇠를 그대로 넣지 않는다', () => {
  const { doc } = ir([{
    type: 'table',
    children: [{ type: 'row', children: [{ type: 'cell', text: '<script>x</script>' }] }],
  }])
  assert.match(doc.blocks[0].html ?? '', /&lt;script&gt;/)
})

// ── 쪽과 스캔 판정 ───────────────────────────────────────────

test('쪽 컨테이너가 블록에 쪽 번호를 단다', () => {
  const { doc } = ir([
    { type: 'page', metadata: { pageNumber: 1 }, children: [문단(200)] },
    { type: 'page', metadata: { pageNumber: 2 }, children: [문단(200)] },
  ])
  assert.deepEqual(doc.blocks.map((b) => b.pageNo), [1, 2])
  assert.equal(doc.meta.pageCount, 2)
})

test('글자 밀도가 낮은 쪽은 스캔으로 보고 이미지 텍스트화로 넘긴다', () => {
  const { doc, scanPages } = ir([
    { type: 'page', metadata: { pageNumber: 1 }, children: [문단(600)] },
    // 쪽 번호와 머리말만 살아 있는 스캔 쪽
    { type: 'page', metadata: { pageNumber: 2 }, children: [문단(0, '- 3 -')] },
    { type: 'page', metadata: { pageNumber: 3 }, children: [] },
  ])
  // 빈 페이지를 성공으로 넘기면 리포트가 「해당 내용 없음」이라 적고 사용자가 믿는다
  assert.deepEqual(scanPages, [2, 3])
  assert.ok(doc.meta.warnings.includes(OFFICE_WARNING.scannedPages))
})

test('밀도 임계값이 경계에서 정확하다', () => {
  assert.equal(needsImageText(MIN_CHARS_PER_TEXT_PAGE), false)
  assert.equal(needsImageText(MIN_CHARS_PER_TEXT_PAGE - 1), true)
  assert.equal(needsImageText(0), true)
})

test('글자가 많은 문서는 스캔 쪽이 없고 품질 점수가 높다', () => {
  const { doc, scanPages } = ir([
    { type: 'page', metadata: { pageNumber: 1 }, children: [문단(800), { type: 'table', children: [{ type: 'row', children: [{ type: 'cell', text: 'ㄱ' }] }] }] },
  ])
  assert.deepEqual(scanPages, [])
  assert.ok(!doc.meta.warnings.includes(OFFICE_WARNING.scannedPages))
  assert.ok(doc.meta.qualityScore >= 55, `점수가 ${doc.meta.qualityScore} 다`)
})

test('쪽 개념이 없는 형식은 전체를 한 쪽으로 본다', () => {
  const { doc, scanPages } = ir([문단(300)])
  assert.equal(doc.meta.pageCount, 1)
  assert.deepEqual(scanPages, [])
})

test('글자를 하나도 못 건지면 경고를 남긴다', () => {
  const { doc } = ir([{ type: 'page', metadata: { pageNumber: 1 }, children: [] }])
  assert.ok(doc.meta.warnings.includes(OFFICE_WARNING.noText))
  assert.equal(doc.blocks.length, 0)
})

// ── 근거 좌표 ────────────────────────────────────────────────

test('source_ref 에 AST 안의 자리가 실린다', () => {
  const { doc } = ir([
    { type: 'page', metadata: { pageNumber: 1 }, children: [문단(0, 'ㄱ'), 문단(0, 'ㄴ')] },
  ])
  assert.deepEqual(doc.blocks.map((b) => b.sourceRef.kind === 'office' && b.sourceRef.nodePath), ['/0/0', '/0/1'])
})

test('같은 AST 를 두 번 옮기면 블록 ID 가 같다', () => {
  const nodes: AstNode[] = [문단(0, '사업금액 5억원')]
  assert.deepEqual(ir(nodes).doc.blocks.map((b) => b.blockId), ir(nodes).doc.blocks.map((b) => b.blockId))
})

// ── 형식 판별 ────────────────────────────────────────────────

test('앞머리 바이트로 형식을 고른다', async () => {
  assert.equal(sniffOffice(new TextEncoder().encode('%PDF-1.7\n')), 'pdf')
  assert.equal(sniffOffice(new TextEncoder().encode('{\\rtf1')), 'rtf')
  assert.equal(sniffOffice(new Uint8Array([1, 2, 3])), 'unknown')
})

test('열 수 없는 형식은 파싱 전에 거절한다', async () => {
  const r = await parseOfficeDoc(new Uint8Array([1, 2, 3]), { fileId: 'f' })
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.reason, 'unsupported_format')
})

// ── 실제 PDF ─────────────────────────────────────────────────

test('실제 PDF 를 끝까지 읽어 쪽별 블록을 만든다', async () => {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF()
  pdf.text('Chapter 1 Overview of the project scope and duration', 20, 20)
  pdf.text('Budget 500,000,000 KRW for twelve months of work here', 20, 30)
  pdf.addPage()
  pdf.text('Page two body text with enough characters to count', 20, 20)
  const bytes = new Uint8Array(pdf.output('arraybuffer'))

  const r = await parseOfficeDoc(bytes, { fileId: 'pdf-1', fileRole: 'rfp_main' })
  assert.ok(r.ok, r.ok === false ? `${r.reason} ${r.detail}` : '')
  if (!r.ok) return

  assert.equal(r.doc.meta.format, 'pdf')
  assert.equal(r.doc.meta.parser, OFFICE_PARSER)
  assert.equal(r.doc.meta.pageCount, 2)
  assert.equal(r.doc.blocks.length, 3)
  assert.deepEqual(r.doc.blocks.map((b) => b.pageNo), [1, 1, 2])
  assert.match(r.doc.blocks[0].text, /Chapter 1 Overview/)
  assert.deepEqual(r.scanPages, [])
})

test('글자가 없는 PDF 는 스캔 쪽으로 잡힌다', async () => {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF()          // 아무것도 안 그린 빈 쪽 = 스캔 PDF 와 같은 모양
  const bytes = new Uint8Array(pdf.output('arraybuffer'))

  const r = await parseOfficeDoc(bytes, { fileId: 'pdf-2' })
  assert.ok(r.ok, r.ok === false ? `${r.reason} ${r.detail}` : '')
  if (!r.ok) return
  assert.deepEqual(r.scanPages, [1], '빈 쪽을 성공으로 넘겼다')
})

// ── 엑셀 (실측 2026-09-19) ───────────────────────────────────

/*
  실제 xlsx 견적서를 넣어 보고서야 드러난 둘이다. 합성 AST 만으로는 안 보였다 —
  officeparser 의 xlsx AST 는 `sheet > row > cell` 이고 `table` 노드가 아예 없으며,
  `cell` 은 자기 text 와 **같은 글을 담은 자식**을 함께 들고 온다.

  그 결과 모델에게 간 글이 이랬다:
    「H100 80GB SXM H100 80GB SXM | ... | 2 2 | 50000000 50000000」
  수량이 22 로 읽히면 견적이 열 배 틀린다.
*/

/** xlsx AST 를 흉내 낸다 — 셀은 text 와 같은 글의 자식을 함께 갖는다 */
function 셀(col: number, text: string): AstNode {
  return { type: 'cell', text, children: [{ type: 'text', text }], metadata: { row: 0, col } }
}

test('★ 셀 글자가 두 번 들어가지 않는다 — 「2 2」가 수량이면 견적이 열 배 틀린다', () => {
  const { doc } = ir([{
    type: 'sheet',
    children: [{ type: 'row', children: [셀(0, 'H100 80GB SXM'), 셀(1, '2')] }],
  }])
  const table = doc.tables[0]
  assert.ok(table, '시트가 표로 안 읽혔다')
  assert.deepEqual(table.cells.map((c) => c.text), ['H100 80GB SXM', '2'])
})

test('★ 시트가 표가 된다 — 행을 문단으로 흩으면 셀 경계가 사라진다', () => {
  const { doc } = ir([{
    type: 'sheet',
    children: [
      { type: 'row', children: [셀(0, '품목'), 셀(1, '수량'), 셀(2, '단가')] },
      { type: 'row', children: [셀(0, 'H100'), 셀(1, '2'), 셀(2, '50000000')] },
    ],
  }])
  assert.equal(doc.tables.length, 1)
  assert.equal(doc.tables[0].rows, 2)
  assert.equal(doc.tables[0].cols, 3)
  assert.equal(doc.blocks.filter((b) => b.type === 'table').length, 1)
  assert.equal(doc.blocks.filter((b) => b.type === 'paragraph').length, 0, '행이 문단으로 샜다')
})

test('★ 빈 칸이 중간에 있어도 열이 안 밀린다 — 밀리면 수량 자리에 단가가 온다', () => {
  // 엑셀은 빈 칸을 아예 안 내보낸다. 「번호 | (빈) | 수량 | 단가」
  const { doc } = ir([{
    type: 'sheet',
    children: [{
      type: 'row',
      children: [셀(0, '1'), 셀(2, '2'), 셀(3, '50000000')],
    }],
  }])
  const t = doc.tables[0]
  assert.equal(t.cols, 4, `열이 ${t.cols}개다 — 좌표를 안 봤다`)
  const byCol = new Map(t.cells.map((c) => [c.c, c.text]))
  assert.equal(byCol.get(0), '1')
  assert.equal(byCol.get(1), '', '빈 칸 자리가 채워졌다')
  assert.equal(byCol.get(2), '2')
  assert.equal(byCol.get(3), '50000000')
})

test('좌표가 없는 표는 예전처럼 나온 순서다 — docx 표가 깨지면 안 된다', () => {
  const { doc } = ir([{
    type: 'table',
    children: [{ type: 'row', children: [
      { type: 'cell', text: '가' }, { type: 'cell', text: '나' },
    ] }],
  }])
  assert.deepEqual(doc.tables[0].cells.map((c) => c.text), ['가', '나'])
})

test('시트 안의 그림은 표를 낸 뒤에도 남는다 — 버리면 근거가 사라진다', () => {
  const { doc } = ir([{
    type: 'sheet',
    children: [
      { type: 'row', children: [셀(0, '품목')] },
      { type: 'image', metadata: { src: 'x.png' } },
    ],
  }])
  assert.equal(doc.tables.length, 1)
  assert.equal(doc.figures.length, 1, '그림이 사라졌다')
})
