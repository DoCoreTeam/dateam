import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEPT_TASK_STATUSES, isDeptTaskStatus, normalizeProgress,
  sanitizeChecklist, parseChecklistText, computeProgress, isProgressAuto,
  dueDiffDays, formatDueLabel, compareDeptTaskUrgency, summarizeDeptTasks,
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

test('computeProgress — done이면 체크리스트/수동값 무관 100', () => {
  assert.equal(computeProgress([{ label: 'a', done: false }], 'done', 0), 100)
  assert.equal(computeProgress([], 'done', 30), 100)
  assert.equal(computeProgress(undefined, 'done'), 100)
})

test('computeProgress — 체크리스트 있으면 done 비율 자동(수동값 무시)', () => {
  assert.equal(computeProgress([{ label: 'a', done: true }, { label: 'b', done: false }], 'doing', 99), 50)
  assert.equal(computeProgress([{ label: 'a', done: true }, { label: 'b', done: true }], 'doing'), 100)
  assert.equal(computeProgress([{ label: 'a', done: false }], 'planned', 80), 0)
  // 3개 중 1개 → 33% 반올림
  assert.equal(computeProgress([{ label: 'a', done: true }, { label: 'b', done: false }, { label: 'c', done: false }], 'doing'), 33)
})

test('computeProgress — 체크리스트 없으면 수동값(범위밖/미지정은 0)', () => {
  assert.equal(computeProgress([], 'doing', 40), 40)
  assert.equal(computeProgress(undefined, 'doing', 40), 40)
  assert.equal(computeProgress([], 'doing', 150), 0)
  assert.equal(computeProgress([], 'doing'), 0)
})

test('isProgressAuto — done이거나 체크리스트 존재 시 자동', () => {
  assert.equal(isProgressAuto([], 'done'), true)
  assert.equal(isProgressAuto([{ label: 'a', done: false }], 'doing'), true)
  assert.equal(isProgressAuto([], 'doing'), false)
  assert.equal(isProgressAuto(undefined, 'planned'), false)
})

test('dueDiffDays — 일수 차/널/오류', () => {
  assert.equal(dueDiffDays('2026-06-10', '2026-06-08'), 2)
  assert.equal(dueDiffDays('2026-06-06', '2026-06-08'), -2)
  assert.equal(dueDiffDays('2026-06-08', '2026-06-08'), 0)
  assert.equal(dueDiffDays(null, '2026-06-08'), null)
  assert.equal(dueDiffDays('garbage', '2026-06-08'), null)
})

test('formatDueLabel — 톤/표기', () => {
  assert.deepEqual(formatDueLabel('2026-06-06', '2026-06-08'), { text: '지남 D+2', tone: 'overdue' })
  assert.deepEqual(formatDueLabel('2026-06-08', '2026-06-08'), { text: '오늘', tone: 'today' })
  assert.deepEqual(formatDueLabel('2026-06-10', '2026-06-08'), { text: 'D-2', tone: 'soon' })
  assert.deepEqual(formatDueLabel('2026-06-20', '2026-06-08'), { text: 'D-12', tone: 'future' })
  assert.deepEqual(formatDueLabel(null, '2026-06-08'), { text: '기한 없음', tone: 'none' })
})

test('compareDeptTaskUrgency — 기한경과>블로커>임박>우선순위>기한순', () => {
  const today = '2026-06-08'
  const overdue = { entry_type: 'planned' as const, priority: 'low' as const, target_date: '2026-06-01' }
  const blocker = { entry_type: 'blocker' as const, priority: 'low' as const, target_date: null }
  const soon = { entry_type: 'planned' as const, priority: 'urgent' as const, target_date: '2026-06-09' }
  const future = { entry_type: 'doing' as const, priority: 'urgent' as const, target_date: '2026-07-01' }
  const sorted = [future, soon, blocker, overdue].sort((a, b) => compareDeptTaskUrgency(a, b, today))
  assert.deepEqual(sorted.map((t) => t.target_date), ['2026-06-01', null, '2026-06-09', '2026-07-01'])
})

test('compareDeptTaskUrgency — 동일 티어는 우선순위→기한순', () => {
  const today = '2026-06-08'
  const a = { entry_type: 'planned' as const, priority: 'high' as const, target_date: '2026-06-09' }
  const b = { entry_type: 'planned' as const, priority: 'urgent' as const, target_date: '2026-06-10' }
  // 둘 다 임박 티어 → urgent(b)가 먼저
  assert.ok(compareDeptTaskUrgency(a, b, today) > 0)
})

test('summarizeDeptTasks — 카운트', () => {
  const today = '2026-06-08'
  const tasks = [
    { entry_type: 'planned' as const, priority: 'normal' as const, target_date: '2026-06-01' }, // overdue
    { entry_type: 'blocker' as const, priority: 'normal' as const, target_date: '2026-06-08' }, // blocker + today
    { entry_type: 'doing' as const, priority: 'normal' as const, target_date: null },
  ]
  assert.deepEqual(summarizeDeptTasks(tasks, today), { total: 3, overdue: 1, blocker: 1, dueToday: 1 })
})

test('parseChecklistText — 줄단위 파싱, 빈 줄 제거', () => {
  assert.deepEqual(parseChecklistText('자료\n\n  초안  \n'), [
    { label: '자료', done: false },
    { label: '초안', done: false },
  ])
  assert.deepEqual(parseChecklistText(''), [])
})
