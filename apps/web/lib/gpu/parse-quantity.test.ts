import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseGpuCount, isBoxPriced, toPerGpuPrice } from './parse-quantity.ts'

test('parseGpuCount — 다양한 입력 형식', () => {
  assert.equal(parseGpuCount('B300 8GPU'), 8)
  assert.equal(parseGpuCount('x8'), 8)
  assert.equal(parseGpuCount('×4'), 4)
  assert.equal(parseGpuCount('8장'), 8)
  assert.equal(parseGpuCount('box(8)'), 8)
  assert.equal(parseGpuCount('A100 (4 GPU)'), 4)
  assert.equal(parseGpuCount('8 GPUs'), 8)
  assert.equal(parseGpuCount('H100'), 1)        // 단서 없음 → fallback
  assert.equal(parseGpuCount(null), 1)
  assert.equal(parseGpuCount('', 2), 2)         // fallback 지정
})

test('parseGpuCount — min_qty(최소주문)를 gpu_count로 오인 금지 (결함 C)', () => {
  // "8장 이상" = 최소주문 → 구성 장수 아님 → fallback 1
  assert.equal(parseGpuCount('8장 이상 주문'), 1)
  assert.equal(parseGpuCount('최소 8 GPU'), 1)
  assert.equal(parseGpuCount('8 GPUs or more'), 1)
  assert.equal(parseGpuCount('min 4'), 1)
  // 진짜 구성 표기는 그대로 인식
  assert.equal(parseGpuCount('B200 ×8 구성'), 8)
  assert.equal(parseGpuCount('8장 세트'), 8)
})

test('isBoxPriced — per-GPU vs 박스 판별', () => {
  assert.equal(isBoxPriced('USD/GPU·hr'), false)
  assert.equal(isBoxPriced('per GPU'), false)
  assert.equal(isBoxPriced('장당'), false)
  assert.equal(isBoxPriced('USD/box'), true)
  assert.equal(isBoxPriced('USD/8GPU'), true)
  assert.equal(isBoxPriced('세트'), true)
  assert.equal(isBoxPriced(null), false)
})

test('toPerGpuPrice — 1장당 환산', () => {
  // per-GPU 가격이면 그대로
  assert.equal(toPerGpuPrice(4.65, 8, 'USD/GPU·hr'), 4.65)
  // 박스 가격이면 ÷ count
  assert.equal(toPerGpuPrice(37.2, 8, 'USD/box'), 4.65)
  assert.equal(toPerGpuPrice(18.6, 4, 'USD/4GPU'), 4.65)
  // count 1이면 동일
  assert.equal(toPerGpuPrice(4.65, 1, 'USD/GPU·hr'), 4.65)
})
