import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compressGrids } from './grid-compress.ts'
import type { SheetGrid } from './intake-grid.ts'

function grid(over: Partial<SheetGrid>): SheetGrid {
  return {
    sheet: 'S1', hidden: false,
    cells: [
      { addr: 'A1', r: 0, c: 0, value: '제목' },
      { addr: 'C6', r: 5, c: 2, value: 'GPU모델 x8' },
      { addr: 'D7', r: 6, c: 3, value: '7000000' },
    ],
    merges: ['A1:C1'], maxR: 6, maxC: 3, ...over,
  }
}

test('좌표·값·병합·시트가시성을 직렬화', () => {
  const r = compressGrids([grid({})])
  assert.match(r.text, /## Sheet: S1 \(visible\)/)
  assert.match(r.text, /merges: A1:C1/)
  assert.match(r.text, /A1=제목/)
  assert.match(r.text, /D7=7000000/)
  assert.equal(r.truncated, false)
  assert.equal(r.cellsIncluded, 3)
})

test('은닉 시트 표기', () => {
  const r = compressGrids([grid({ hidden: true })])
  assert.match(r.text, /\(hidden\)/)
})

test('셀 캡 초과 시 잘림 명시(무음 손실 금지)', () => {
  const r = compressGrids([grid({})], { maxCells: 2 })
  assert.equal(r.truncated, true)
  assert.equal(r.cellsIncluded, 2)
  assert.match(r.text, /잘림: 1개 셀/)
})

test('여러 시트 누적', () => {
  const r = compressGrids([grid({ sheet: 'A' }), grid({ sheet: 'B' })])
  assert.match(r.text, /## Sheet: A/)
  assert.match(r.text, /## Sheet: B/)
  assert.equal(r.cellsTotal, 6)
})
