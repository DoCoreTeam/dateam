import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatCardMemory, perCardMemory, memoryTitle } from './card-memory.ts'

test('장수>1 정수분할 → 카드당 × 장수', () => {
  assert.equal(formatCardMemory('80GB', 2), '40GB × 2')
  assert.equal(formatCardMemory('160GB', 4), '40GB × 4')
  assert.equal(formatCardMemory('360GB', 2), '180GB × 2')
})

test('장수 1 또는 미지정 → 총합 그대로(×1 미표기)', () => {
  assert.equal(formatCardMemory('40GB', 1), '40GB')
  assert.equal(formatCardMemory('80GB', null), '80GB')
  assert.equal(formatCardMemory('80GB', undefined), '80GB')
})

test('비정수 분할 → 총합 폴백', () => {
  assert.equal(formatCardMemory('75GB', 2), '75GB')
})

test('null/빈/파싱불가 → 폴백', () => {
  assert.equal(formatCardMemory(null, 2), '')
  assert.equal(formatCardMemory('', 2), '')
  assert.equal(formatCardMemory('N/A', 2), 'N/A')
})

test('perCardMemory: 카드당 용량만(×N 미표기)', () => {
  assert.equal(perCardMemory('80GB', 2), '40GB')
  assert.equal(perCardMemory('320GB', 8), '40GB')
  assert.equal(perCardMemory('40GB', 1), '40GB')
  assert.equal(perCardMemory('75GB', 2), '75GB')
  assert.equal(perCardMemory(null, 2), '')
})

test('memoryTitle: 장수>1만 총용량 툴팁, 그 외 빈문자열', () => {
  assert.equal(memoryTitle('80GB', 2), '총 80GB (40GB × 2)')
  assert.equal(memoryTitle('320GB', 8), '총 320GB (40GB × 8)')
  assert.equal(memoryTitle('40GB', 1), '')
  assert.equal(memoryTitle('80GB', null), '')
  assert.equal(memoryTitle('75GB', 2), '')
  assert.equal(memoryTitle(null, 2), '')
})
