import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcile } from './reconcile.ts'

test('reconcile — 누락 없음(9행 전사 = 9행 추출)', () => {
  const extracted = Array.from({ length: 9 }, (_, i) => ({ source_model_name: `M${i}` }))
  const r = reconcile(9, extracted)
  assert.equal(r.source_rows, 9)
  assert.equal(r.extracted, 9)
  assert.equal(r.missing, 0)
  assert.deepEqual(r.missing_labels, [])
})

test('reconcile — 누락 발생(9행 중 5행 추출 → 4행 누락)', () => {
  const extracted = Array.from({ length: 5 }, (_, i) => ({ source_model_name: `M${i}` }))
  const r = reconcile(9, extracted)
  assert.equal(r.source_rows, 9)
  assert.equal(r.extracted, 5)
  assert.equal(r.missing, 4)
})

test('reconcile — missing_labels: 추출에 없는 전사 라벨 차집합', () => {
  const labels = ['HGX B300', 'HGX B200', 'HGX H200', 'HGX H100', 'RTX PRO 6000', 'L40S', 'GB300', 'GB200', 'X']
  const extracted = [
    { source_model_name: 'HGX H200' },
    { source_model_name: 'HGX H100' },
    { source_model_name: 'L40S' },
    { source_model_name: 'X' },
  ]
  const r = reconcile(9, extracted, labels)
  assert.equal(r.missing, 5)
  assert.ok(r.missing_labels.includes('HGX B300'))
  assert.ok(r.missing_labels.includes('HGX B200'))
  assert.ok(r.missing_labels.includes('GB300'))
  assert.ok(r.missing_labels.includes('GB200'))
  assert.ok(!r.missing_labels.includes('HGX H200'))
})

test('reconcile — 라벨 대조는 대소문자/공백 무시', () => {
  const r = reconcile(2, [{ source_model_name: '  hgx b300 ' }], ['HGX B300', 'GB200'])
  assert.equal(r.missing, 1)
  assert.deepEqual(r.missing_labels, ['GB200'])
})

test('reconcile — model_name 폴백(source_model_name 없을 때)', () => {
  const r = reconcile(2, [{ model_name: 'H100' }], ['H100', 'B200'])
  assert.equal(r.missing, 1)
  assert.deepEqual(r.missing_labels, ['B200'])
})

test('reconcile — missing_labels는 missing 수를 넘지 않음(과경고 방지)', () => {
  // 추출이 라벨과 전혀 매칭 안 되지만 missing=1 → 라벨은 1개만
  const r = reconcile(1, [{ source_model_name: 'Z' }], ['A', 'B', 'C'])
  assert.equal(r.missing, 0) // source 1 - extracted 1 = 0
  assert.deepEqual(r.missing_labels, [])
})

test('reconcile — source_rows 0 또는 음수/NaN 방어', () => {
  assert.deepEqual(reconcile(0, []), { source_rows: 0, extracted: 0, missing: 0, missing_labels: [] })
  assert.equal(reconcile(-5, []).source_rows, 0)
  assert.equal(reconcile(NaN, [{ model_name: 'A' }]).source_rows, 0)
  assert.equal(reconcile(NaN, [{ model_name: 'A' }]).missing, 0)
})

test('reconcile — 추출 > 원본이면 missing 0(음수 클램프)', () => {
  const r = reconcile(2, [{ model_name: 'A' }, { model_name: 'B' }, { model_name: 'C' }])
  assert.equal(r.missing, 0)
})

test('reconcile — 비배열 extracted 방어', () => {
  const r = reconcile(3, undefined as unknown as [])
  assert.equal(r.extracted, 0)
  assert.equal(r.missing, 3)
})

test('reconcile — 라벨 중복 제거', () => {
  const r = reconcile(3, [], ['A', 'A', 'B'])
  // source 3 - extracted 0 = 3 missing, 라벨 차집합은 A,B (중복 제거)
  assert.equal(r.missing, 3)
  assert.deepEqual(r.missing_labels, ['A', 'B'])
})
