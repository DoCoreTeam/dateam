import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evalDailyExtraction, isOverFragmented, DAILY_GOLDEN } from './daily-quality.ts'

test('정상 추출 → ok', () => {
  const q = evalDailyExtraction('A사 미팅 준비하고 제안서 정리함', [{ status: 'done', confidence: 0.9 }])
  assert.equal(q.ok, true)
  assert.equal(q.itemCount, 1)
})

test('과분할 → ok:false (1k당 임계 초과)', () => {
  // 20자 입력에 8개 항목 → 1k당 400개 → 과분할
  const items = Array.from({ length: 8 }, () => ({ status: 'note', confidence: 0.9 }))
  const q = evalDailyExtraction('짧은입력 20자 정도의 텍스트', items)
  assert.equal(q.ok, false)
  assert.match(q.reasons.join(','), /과분할/)
})

test('저신뢰 → ok:false', () => {
  const q = evalDailyExtraction('충분히 긴 입력 텍스트를 여기에 적어서 과분할 임계를 피한다 길게길게 적는다', [{ status: 'doing', confidence: 0.3 }])
  assert.equal(q.ok, false)
  assert.match(q.reasons.join(','), /신뢰도/)
})

test('confidence 없으면 1로 간주', () => {
  const q = evalDailyExtraction('긴 입력 텍스트 적당히 길게 적어서 과분할 회피한다 더 길게', [{ status: 'done' }])
  assert.equal(q.avgConfidence, 1)
})

test('빈 추출(긴 입력 0건) → ok:false (프롬프트 고장 신호)', () => {
  const q = evalDailyExtraction('이건 충분히 긴 입력인데 AI가 아무 항목도 못 뽑은 상황을 가정한다 30자 이상', [])
  assert.equal(q.ok, false)
  assert.match(q.reasons.join(','), /추출 0건/)
})

test('짧은 입력 0건 → ok:true (고장 아님)', () => {
  assert.equal(evalDailyExtraction('짧음', []).ok, true)
})

test('isOverFragmented golden 비교', () => {
  assert.equal(isOverFragmented(1, 3), true)
  assert.equal(isOverFragmented(2, 2), false)
})

test('DAILY_GOLDEN 케이스 존재', () => {
  assert.ok(DAILY_GOLDEN.length >= 3)
  assert.ok(DAILY_GOLDEN.every((c) => c.maxItems >= 1 && c.input.length > 0))
})
