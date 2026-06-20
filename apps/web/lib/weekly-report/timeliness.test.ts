import { test } from 'node:test'
import assert from 'node:assert/strict'
import { weekDeadlines, judgeTimeliness, formatDelay, formatKst, summarizeActivity } from './timeliness.ts'

// 기준 주차: 2026-06-15(월). KST 토 00:00 = 06-20 00:00+09 = 06-19T15:00:00Z, 월 00:00 = 06-22 00:00+09 = 06-21T15:00:00Z
const WEEK = '2026-06-15'

test('weekDeadlines: KST 토/월 00:00 → UTC 변환 정확', () => {
  const { satDue, monDue } = weekDeadlines(WEEK)
  assert.equal(satDue, '2026-06-19T15:00:00.000Z')
  assert.equal(monDue, '2026-06-21T15:00:00.000Z')
})

test('정시: 금요일 작성, 미취합', () => {
  const r = judgeTimeliness({
    firstAt: '2026-06-17T01:00:00Z', lastAt: '2026-06-19T05:00:00Z', // 금 14:00 KST (토 00:00 전)
    confirmedAt: null, weekStart: WEEK, now: '2026-06-19T06:00:00Z',
  })
  assert.equal(r.status, 'on_time')
  assert.equal(r.delayMinutes, 0)
})

test('지연(1차): 토요일 작성', () => {
  const r = judgeTimeliness({
    firstAt: '2026-06-20T03:00:00Z', lastAt: '2026-06-20T03:00:00Z', // 토 12:00 KST
    confirmedAt: null, weekStart: WEEK, now: '2026-06-20T04:00:00Z',
  })
  assert.equal(r.status, 'late')
  assert.ok(r.delayMinutes > 0)
})

test('지연: 취합 이후 수정(토요일 전이라도)', () => {
  const r = judgeTimeliness({
    firstAt: '2026-06-16T01:00:00Z',
    lastAt: '2026-06-18T05:00:00Z',     // 목 14:00 KST, 토 전
    confirmedAt: '2026-06-18T02:00:00Z', // 목 11:00 KST 취합 → 그 이후 수정
    weekStart: WEEK, now: '2026-06-18T06:00:00Z',
  })
  assert.equal(r.status, 'late')
})

test('정시: 취합 이전에만 작성(취합 전 마지막 수정)', () => {
  const r = judgeTimeliness({
    firstAt: '2026-06-16T01:00:00Z',
    lastAt: '2026-06-17T01:00:00Z',      // 수 10:00 KST
    confirmedAt: '2026-06-18T02:00:00Z', // 목 취합 (작성이 취합보다 앞)
    weekStart: WEEK, now: '2026-06-18T06:00:00Z',
  })
  assert.equal(r.status, 'on_time')
})

test('최종지연: 다음 주 월요일 이후 작성', () => {
  const r = judgeTimeliness({
    firstAt: '2026-06-22T02:00:00Z', lastAt: '2026-06-22T02:00:00Z', // 월 11:00 KST (다음주)
    confirmedAt: null, weekStart: WEEK, now: '2026-06-22T03:00:00Z',
  })
  assert.equal(r.status, 'final_late')
  assert.ok(r.delayMinutes > 0)
})

test('미작성: 토요일 전 = 진행중', () => {
  const r = judgeTimeliness({
    firstAt: null, lastAt: null, confirmedAt: null,
    weekStart: WEEK, now: '2026-06-18T00:00:00Z', // 목
  })
  assert.equal(r.status, 'in_progress')
})

test('미작성: 토~월 사이 = 지연', () => {
  const r = judgeTimeliness({
    firstAt: null, lastAt: null, confirmedAt: null,
    weekStart: WEEK, now: '2026-06-20T06:00:00Z', // 토 15:00 KST
  })
  assert.equal(r.status, 'late')
})

test('미제출: 다음 주 월 이후 미작성 = missing', () => {
  const r = judgeTimeliness({
    firstAt: null, lastAt: null, confirmedAt: null,
    weekStart: WEEK, now: '2026-06-23T00:00:00Z', // 화(다음주)
  })
  assert.equal(r.status, 'missing')
})

test('재취합 우회 불가: 토요일 넘긴 작성은 취합이 늦어도 지연', () => {
  const r = judgeTimeliness({
    firstAt: '2026-06-20T06:00:00Z', lastAt: '2026-06-20T06:00:00Z', // 토 15:00 KST
    confirmedAt: '2026-06-22T00:00:00Z', // 취합을 일요일~월에 늦게 함
    weekStart: WEEK, now: '2026-06-22T01:00:00Z',
  })
  assert.equal(r.status, 'late') // 토요일선 고정 → 정시 아님
})

test('weekDeadlines: 월 경계 (06-29주 → 07월로 넘어감)', () => {
  const { satDue, monDue } = weekDeadlines('2026-06-29')
  assert.equal(satDue, '2026-07-03T15:00:00.000Z') // 07-04 00:00 KST
  assert.equal(monDue, '2026-07-05T15:00:00.000Z') // 07-06 00:00 KST
})

test('weekDeadlines: 연 경계 (2025-12-29주 → 2026년으로 넘어감)', () => {
  const { satDue, monDue } = weekDeadlines('2025-12-29')
  assert.equal(satDue, '2026-01-02T15:00:00.000Z') // 01-03 00:00 KST
  assert.equal(monDue, '2026-01-04T15:00:00.000Z') // 01-05 00:00 KST
})

test('연 경계: 다음 해 월요일 이후 작성 = 최종지연', () => {
  const r = judgeTimeliness({
    firstAt: '2026-01-05T01:00:00Z', lastAt: '2026-01-05T01:00:00Z', // monDue(01-04T15Z) 이후
    confirmedAt: null, weekStart: '2025-12-29', now: '2026-01-05T02:00:00Z',
  })
  assert.equal(r.status, 'final_late')
})

test('지연: 취합 완료 후에도 미작성 = late (in_progress 아님) — DC-QA', () => {
  const r = judgeTimeliness({
    firstAt: null, lastAt: null,
    confirmedAt: '2026-06-17T01:00:00Z', // 수 취합 완료
    weekStart: WEEK, now: '2026-06-18T00:00:00Z', // 목(토 전)인데 이미 취합됨
  })
  assert.equal(r.status, 'late')
})

test('진행중: 취합 전 + 토 전 미작성', () => {
  const r = judgeTimeliness({
    firstAt: null, lastAt: null, confirmedAt: null,
    weekStart: WEEK, now: '2026-06-17T00:00:00Z', // 수
  })
  assert.equal(r.status, 'in_progress')
})

test('경계: lastAt === confirmedAt 동시각이면 정시 (취합 이후 수정 아님)', () => {
  const r = judgeTimeliness({
    firstAt: '2026-06-16T01:00:00Z', lastAt: '2026-06-17T02:00:00Z',
    confirmedAt: '2026-06-17T02:00:00Z', // 최종작성 == 취합 동시각
    weekStart: WEEK, now: '2026-06-17T03:00:00Z',
  })
  assert.equal(r.status, 'on_time')
})

test('경계: 취합이 토요일보다 미래여도 토 이전 작성은 정시', () => {
  const r = judgeTimeliness({
    firstAt: '2026-06-17T01:00:00Z', lastAt: '2026-06-18T05:00:00Z', // 금 14:00 KST, 토 전
    confirmedAt: '2026-06-22T00:00:00Z', // 취합이 다음주(미래)
    weekStart: WEEK, now: '2026-06-22T01:00:00Z',
  })
  assert.equal(r.status, 'on_time')
})

test('summarizeActivity: create→edit → first=create, last=edit', () => {
  const s = summarizeActivity([
    { occurredAt: '2026-06-16T01:00:00Z', action: 'create' },
    { occurredAt: '2026-06-18T05:00:00Z', action: 'edit' },
  ])
  assert.equal(s.firstAt, '2026-06-16T01:00:00Z')
  assert.equal(s.lastAt, '2026-06-18T05:00:00Z')
})

test('summarizeActivity: 최신이 delete면 현재 미작성(null) — H1 회귀 방지', () => {
  const s = summarizeActivity([
    { occurredAt: '2026-06-16T01:00:00Z', action: 'create' },
    { occurredAt: '2026-06-19T01:00:00Z', action: 'delete' },
  ])
  assert.equal(s.firstAt, null)
  assert.equal(s.lastAt, null)
})

test('summarizeActivity: delete 후 재작성하면 다시 작성됨으로 집계', () => {
  const s = summarizeActivity([
    { occurredAt: '2026-06-16T01:00:00Z', action: 'create' },
    { occurredAt: '2026-06-17T01:00:00Z', action: 'delete' },
    { occurredAt: '2026-06-18T01:00:00Z', action: 'create' },
  ])
  assert.equal(s.firstAt, '2026-06-18T01:00:00Z')
  assert.equal(s.lastAt, '2026-06-18T01:00:00Z')
})

test('summarizeActivity: 빈 로그 = null', () => {
  const s = summarizeActivity([])
  assert.equal(s.firstAt, null)
  assert.equal(s.lastAt, null)
})

test('formatDelay: 사람이 읽는 표현 (일+분 손실 없음)', () => {
  assert.equal(formatDelay(0), '-')
  assert.equal(formatDelay(15), '15분')
  assert.equal(formatDelay(125), '2시간 5분')
  assert.equal(formatDelay(1440 + 180), '1일 3시간')
  assert.equal(formatDelay(1441), '1일 1분') // 일 단위에서도 분 보존
  assert.equal(formatDelay(1440), '1일')
})

test('formatKst: KST 변환 + null 가드', () => {
  assert.equal(formatKst(null), '-')
  // 2026-06-19T15:00:00Z = 06/20 00:00 KST
  assert.equal(formatKst('2026-06-19T15:00:00Z'), '06/20 00:00')
})
