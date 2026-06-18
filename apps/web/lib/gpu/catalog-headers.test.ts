import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectHeaderRow, assembleFromAoa } from './catalog-headers.ts'

const idy = (s: string) => s   // sanitize 미적용(순수 조립 검증용)

test('1행이 헤더인 평범한 표 → 0행 탐지', () => {
  const aoa = [['competitor', 'model', 'price'], ['RunPod', 'H100', 2.35], ['Lambda', 'A100', 1.1]]
  assert.equal(detectHeaderRow(aoa), 0)
  const r = assembleFromAoa(aoa, 0, idy, 1000)
  assert.deepEqual(r.headers, ['competitor', 'model', 'price'])
  assert.equal(r.totalRows, 2)
  assert.equal(r.rows[0].competitor, 'RunPod')
})

test('상단 제목/환율/빈 행 건너뛰고 헤더행 탐지', () => {
  const aoa = [
    ['2026 타겟금액 취합', null, null],
    ['환율적용시', 1500, null],
    [null, null, null],
    ['competitor', 'model', 'price'],   // 진짜 헤더(idx 3)
    ['RunPod', 'H100', 2.35],
    ['Lambda', 'A100', 1.1],
  ]
  const idx = detectHeaderRow(aoa)
  assert.equal(idx, 3)
  const r = assembleFromAoa(aoa, idx, idy, 1000)
  assert.deepEqual(r.headers, ['competitor', 'model', 'price'])
  assert.equal(r.rows[0].model, 'H100')
  assert.equal(r.totalRows, 2)
})

test('빈 헤더 셀 → col{i}, 중복 라벨 → 접미사', () => {
  const aoa = [['model', null, 'model', 'price'], ['H100', null, null, 2.35]]
  const r = assembleFromAoa(aoa, 0, idy, 1000)
  assert.deepEqual(r.headers, ['model', 'col2', 'model_1', 'price'])
})

test('데이터 행 상한(maxRows) 적용 + totalRows는 원본', () => {
  const aoa = [['a', 'b'], ...Array.from({ length: 5 }, (_, i) => [`r${i}`, i])]
  const r = assembleFromAoa(aoa, 0, idy, 2)
  assert.equal(r.totalRows, 5)
  assert.equal(r.rows.length, 2)
})

test('sanitize는 문자열 셀에만 적용', () => {
  const r = assembleFromAoa([['a', 'b'], ['=cmd()', 99]], 0, (s) => "'" + s, 1000)
  assert.equal(r.rows[0].a, "'=cmd()")
  assert.equal(r.rows[0].b, 99) // 숫자 미변경
})

test('모두 sparse하면 0행 폴백', () => {
  assert.equal(detectHeaderRow([[null, "x"], [null, null]]), 0) // ne>=2 행만 후보; 없으면 0
  assert.equal(detectHeaderRow([['only', null]]), 0)
})
