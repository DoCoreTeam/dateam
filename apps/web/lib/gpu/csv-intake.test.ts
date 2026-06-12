import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeCell, parseCsv, csvToIntakeRows } from './csv-intake.ts'

test('수식 인젝션: =,+,-,@ 선두 셀에 작은따옴표 부착', () => {
  assert.equal(sanitizeCell('=SUM(A1:A2)'), "'=SUM(A1:A2)")
  assert.equal(sanitizeCell('+1+1'), "'+1+1")
  assert.equal(sanitizeCell('-2'), "'-2")
  assert.equal(sanitizeCell('@cmd'), "'@cmd")
})

test('수식 인젝션: 선행 탭/CR/LF도 무력화', () => {
  assert.equal(sanitizeCell('\t=1'), "'\t=1")
  assert.equal(sanitizeCell('\r=1'), "'\r=1")
  assert.equal(sanitizeCell('\n=1'), "'\n=1")
})

test('수식 인젝션: 선행 공백 후 수식도 무력화(공백 우회 차단)', () => {
  assert.equal(sanitizeCell('   =SUM(A1)'), "'   =SUM(A1)")
  assert.equal(sanitizeCell(' @cmd'), "' @cmd")
})

test('정상 값은 그대로', () => {
  assert.equal(sanitizeCell('H100 80GB'), 'H100 80GB')
  assert.equal(sanitizeCell('2.35'), '2.35')
  assert.equal(sanitizeCell(''), '')
})

test('parseCsv: 기본 콤마 + 따옴표 내 콤마/개행', () => {
  const grid = parseCsv('a,b,c\n"x,y",z,"line1\nline2"')
  assert.deepEqual(grid[0], ['a', 'b', 'c'])
  assert.deepEqual(grid[1], ['x,y', 'z', 'line1\nline2'])
})

test('parseCsv: 탭 구분 자동 감지', () => {
  const grid = parseCsv('a\tb\tc\n1\t2\t3')
  assert.deepEqual(grid[1], ['1', '2', '3'])
})

test('parseCsv: 빈 줄 제거', () => {
  const grid = parseCsv('a,b\n\n1,2\n')
  assert.equal(grid.length, 2)
})

test('csvToIntakeRows: 한글 헤더 자동 매핑 + sanitize', () => {
  const csv = '모델,메모리,공급사,단가\nH100 80GB,80GB,RunPod,=2.35'
  const r = csvToIntakeRows(csv)
  assert.deepEqual(r.mapping, ['model_name', 'memory', 'supplier', 'unit_price_usd'])
  assert.equal(r.rows[0].model_name, 'H100 80GB')
  assert.equal(r.rows[0].supplier, 'RunPod')
  // 단가 셀이 =로 시작 → 무력화
  assert.equal(r.rows[0].unit_price_usd, "'=2.35")
})

test('csvToIntakeRows: 영문 헤더 + 미매핑 헤더 보고', () => {
  const csv = 'model,price,foobar\nA100,1.89,zzz'
  const r = csvToIntakeRows(csv)
  assert.equal(r.mapping[0], 'model_name')
  assert.equal(r.mapping[1], 'unit_price_usd')
  assert.equal(r.mapping[2], undefined)
  assert.deepEqual(r.unmappedHeaders, ['foobar'])
})

test('csvToIntakeRows: 빈 입력', () => {
  const r = csvToIntakeRows('')
  assert.deepEqual(r.rows, [])
})
