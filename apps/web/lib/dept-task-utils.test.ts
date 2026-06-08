import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEPT_TASK_STATUSES, isDeptTaskStatus, normalizeProgress,
  sanitizeChecklist, parseChecklistText,
} from './dept-task-utils.ts'

test('DEPT_TASK_STATUSES — note 제외 4종', () => {
  assert.deepEqual(DEPT_TASK_STATUSES, ['planned', 'doing', 'blocker', 'done'])
  assert.equal(DEPT_TASK_STATUSES.includes('note'), false)
})

test('isDeptTaskStatus — 유효/무효 판정', () => {
  assert.equal(isDeptTaskStatus('doing'), true)
  assert.equal(isDeptTaskStatus('done'), true)
  assert.equal(isDeptTaskStatus('note'), false)
  assert.equal(isDeptTaskStatus('garbage'), false)
})

test('normalizeProgress — 경계값', () => {
  assert.equal(normalizeProgress(0), 0)
  assert.equal(normalizeProgress(100), 100)
  assert.equal(normalizeProgress(40.6), 41)
  assert.equal(normalizeProgress(0.4), 0)
  assert.equal(normalizeProgress(-1), null)
  assert.equal(normalizeProgress(101), null)
  assert.equal(normalizeProgress(NaN), null)
  assert.equal(normalizeProgress(Infinity), null)
  assert.equal(normalizeProgress(-Infinity), null)
})

test('sanitizeChecklist — 비배열/비문자열/상한/트림', () => {
  assert.deepEqual(sanitizeChecklist(undefined), [])
  // @ts-expect-error 런타임 방어 검증
  assert.deepEqual(sanitizeChecklist(null), [])
  // @ts-expect-error 런타임 방어 검증
  assert.deepEqual(sanitizeChecklist('not-array'), [])
  // 라벨 정확히 500자 경계
  assert.equal(sanitizeChecklist([{ label: 'y'.repeat(500), done: false }])[0].label.length, 500)
  assert.deepEqual(
    sanitizeChecklist([{ label: '  항목  ', done: 1 as unknown as boolean }]),
    [{ label: '항목', done: true }],
  )
  // 비문자열 라벨 제거
  assert.deepEqual(
    sanitizeChecklist([{ label: 5 as unknown as string, done: false }, { label: 'ok', done: false }]),
    [{ label: 'ok', done: false }],
  )
  // 50개 상한
  const many = Array.from({ length: 60 }, (_, i) => ({ label: `L${i}`, done: false }))
  assert.equal(sanitizeChecklist(many).length, 50)
  // 500자 컷
  const long = sanitizeChecklist([{ label: 'x'.repeat(600), done: false }])
  assert.equal(long[0].label.length, 500)
})

test('parseChecklistText — 줄단위 파싱, 빈 줄 제거', () => {
  assert.deepEqual(parseChecklistText('자료\n\n  초안  \n'), [
    { label: '자료', done: false },
    { label: '초안', done: false },
  ])
  assert.deepEqual(parseChecklistText(''), [])
})
