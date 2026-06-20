import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { bufferToGrids } from './intake-grid.ts'

// 합성 워크북: 2시트(1개 은닉) + 병합 + 수식인젝션 셀 → 결정적 검증.
function buildBuffer(): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  // 시트1: 다중 블록 흉내 + 병합 + 수식
  const aoa1 = [
    ['제목', null, null],          // A1
    ['모델', '가격', '=2+2'],      // A2 헤더 / C2 수식 인젝션
    ['T4', 1000, null],            // A3
    [null, null, null],            // 빈 행
    ['모델', '가격', null],        // A5 두 번째 블록 헤더
    ['V100', 2000, null],          // A6
  ]
  const ws1 = XLSX.utils.aoa_to_sheet(aoa1)
  ws1['!merges'] = [XLSX.utils.decode_range('A1:C1')]
  XLSX.utils.book_append_sheet(wb, ws1, 'S1')
  // 시트2: 은닉
  const ws2 = XLSX.utils.aoa_to_sheet([['x', 'y']])
  XLSX.utils.book_append_sheet(wb, ws2, 'S2hidden')
  wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return out as ArrayBuffer
}

test('전 시트를 읽는다(첫 시트만 아님)', () => {
  const grids = bufferToGrids(buildBuffer())
  assert.deepEqual(grids.map((g) => g.sheet), ['S1', 'S2hidden'])
})

test('은닉 시트 메타를 보존한다', () => {
  const grids = bufferToGrids(buildBuffer())
  assert.equal(grids[0].hidden, false)
  assert.equal(grids[1].hidden, true)
})

test('병합 범위를 A1 표기로 보존한다', () => {
  const grids = bufferToGrids(buildBuffer())
  assert.ok(grids[0].merges.includes('A1:C1'))
})

test('빈 셀은 제외하고 좌표를 정확히 보존한다', () => {
  const grids = bufferToGrids(buildBuffer())
  const s1 = grids[0]
  const t4 = s1.cells.find((c) => c.value === 'T4')
  assert.ok(t4, 'T4 셀 존재')
  assert.equal(t4.addr, 'A3')
  assert.equal(t4.r, 2)
  assert.equal(t4.c, 0)
  // 빈 행(4행)에는 셀이 없어야 함
  assert.equal(s1.cells.some((c) => c.r === 3), false)
})

test('수식 인젝션 셀을 무력화한다(선행 작은따옴표)', () => {
  const grids = bufferToGrids(buildBuffer())
  const formula = grids[0].cells.find((c) => c.addr === 'C2')
  assert.ok(formula)
  assert.equal(formula.value, "'=2+2")
})

test('숫자 값을 원시 정밀도 문자열로 보존한다', () => {
  const grids = bufferToGrids(buildBuffer())
  const price = grids[0].cells.find((c) => c.addr === 'B3')
  assert.ok(price)
  assert.equal(price.value, '1000')
})
