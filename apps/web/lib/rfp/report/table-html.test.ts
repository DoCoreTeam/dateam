import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSimpleTable, looksLikeDataTable, MAX_ROWS, MAX_DATA_COLS } from './table-html.ts'

test('★ 표를 다시 표로 — 평문으로 뭉개면 「우편번호 42620 주소 …」가 한 문단이 된다', () => {
  // 실측(콜롬비아 AI 제안요청서)의 첫 표
  const html = '<table><tr><td>우편번호:</td><td>42620</td></tr><tr><td>주소:</td><td>대구광역시 달서구</td></tr></table>'
  const t = parseSimpleTable(html)
  assert.ok(t)
  assert.deepEqual(t?.rows, [['우편번호:', '42620'], ['주소:', '대구광역시 달서구']])
})

test('HTML 실체를 되돌린다 — 파서가 &lt; 로 저장한다', () => {
  const t = parseSimpleTable('<table><tr><td>&lt; 청렴계약 &gt;</td></tr></table>')
  assert.equal(t?.rows[0][0], '< 청렴계약 >')
})

test('줄마다 칸 수가 달라도 맞춰 준다 — 안 맞추면 표가 어긋난다', () => {
  const t = parseSimpleTable('<table><tr><td>가</td><td>나</td><td>다</td></tr><tr><td>라</td></tr></table>')
  assert.deepEqual(t?.rows, [['가', '나', '다'], ['라', '', '']])
})

test('첫 줄이 다 차 있어야 머리글이다', () => {
  const full = parseSimpleTable('<table><tr><td>구분</td><td>내용</td></tr><tr><td>가</td><td>나</td></tr></table>')
  assert.equal(full?.hasHeader, true)
  const holey = parseSimpleTable('<table><tr><td>구분</td><td></td></tr><tr><td>가</td><td>나</td></tr></table>')
  assert.equal(holey?.hasHeader, false)
})

test('표가 아니면 null — 호출부가 원문 글자로 떨어진다', () => {
  assert.equal(parseSimpleTable('그냥 문단입니다'), null)
  assert.equal(parseSimpleTable(null), null)
  assert.equal(parseSimpleTable(''), null)
})

test('빈 격자는 안 그린다', () => {
  assert.equal(parseSimpleTable('<table><tr><td></td><td></td></tr></table>'), null)
})

test('줄이 너무 많으면 자른다 — 표 하나가 화면을 다 먹는다', () => {
  const html = `<table>${'<tr><td>가</td></tr>'.repeat(500)}</table>`
  assert.equal(parseSimpleTable(html)?.rows.length, MAX_ROWS)
})

test('셀 안의 태그는 벗긴다', () => {
  const t = parseSimpleTable('<table><tr><td><p>값</p></td></tr></table>')
  assert.equal(t?.rows[0][0], '값')
})

test('★ 레이아웃 표는 표로 안 그린다 — 실측: 「우/편/번/호」로 세로로 쪼개졌다', () => {
  // 공고문 머리말: 열 11개에 대부분 빈칸. 자리를 잡으려고 쓴 표다
  const layout = parseSimpleTable(
    '<table><tr><td>우편번호:</td><td>42620</td><td>주소:</td><td>대구</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>'
    + '<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>가</td></tr></table>',
  )
  assert.ok(layout)
  assert.equal(looksLikeDataTable(layout!), false)
})

test('데이터 표는 표로 그린다 — 요구사항 총괄표·평가 배점표', () => {
  const data = parseSimpleTable(
    '<table><tr><td>구분</td><td>배점</td></tr><tr><td>기술능력</td><td>90</td></tr><tr><td>입찰가격</td><td>10</td></tr></table>',
  )
  assert.ok(data)
  assert.equal(looksLikeDataTable(data!), true)
})

test('한 줄짜리는 표가 아니라 한 문단이다', () => {
  const one = parseSimpleTable('<table><tr><td>가</td><td>나</td></tr></table>')
  assert.equal(looksLikeDataTable(one!), false)
})

test('열이 너무 많으면 좁은 자리에서 못 읽는다', () => {
  const cells = Array.from({ length: MAX_DATA_COLS + 2 }, (_, i) => `<td>v${i}</td>`).join('')
  const wide = parseSimpleTable(`<table><tr>${cells}</tr><tr>${cells}</tr></table>`)
  assert.equal(looksLikeDataTable(wide!), false)
})
