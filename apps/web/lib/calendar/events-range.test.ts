/**
 * 기간 일정 SSOT (P0170 I07, 지시서 문제 5-1)
 *
 * 월별 조회가 [] 이고 기간 조회는 일정이 나왔다: month 는 일일업무 요약, events 는 일정이라 다른 표였다
 * month?include=events 와 events 가 같은 함수를 쓰고, 달 경계가 KST 로 잘리는지 본다
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { listCalendarEventsInRange } from './events-range.ts'

const ME = 'u1'

/** 조회 조건을 기록하고 정해 둔 행을 돌려주는 가짜 supabase */
function fakeDb(rows: Record<string, unknown>[]) {
  const seen: { lte?: string; or?: string } = {}
  const chain = {
    select: () => chain,
    lte: (_c: string, v: string) => { seen.lte = v; return chain },
    or: (v: string) => { seen.or = v; return chain },
    order: () => chain,
    in: () => chain,
    is: () => Promise.resolve({ data: [] }),
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  return { db: { from: () => chain }, seen }
}

const ev = (id: string, start: string, extra: Record<string, unknown> = {}) => ({
  id, title: id, start_at: start, end_at: null, all_day: false, source: 'user', link_kind: null, link_id: null,
  status: null, user_id: ME, rrule: null, ...extra,
})

test('한 달 범위는 KST 1일 00:00 부터 말일 23:59:59.999 까지다', async () => {
  const { db, seen } = fakeDb([])
  await listCalendarEventsInRange(db, ME, '2026-10-01', '2026-10-31')
  assert.equal(seen.lte, '2026-10-31T14:59:59.999Z')
  assert.match(seen.or ?? '', /start_at\.gte\.2026-09-30T15:00:00\.000Z/)
})

test('KST 말일 밤 일정은 그 달에, 다음 달 1일 새벽 일정은 빠진다', async () => {
  const { db } = fakeDb([
    ev('last-night', '2026-10-31T14:00:00.000Z'), // KST 10/31 23:00
    ev('first-dawn', '2026-09-30T15:30:00.000Z'), // KST 10/01 00:30
    ev('next-month', '2026-10-31T15:30:00.000Z'), // KST 11/01 00:30
  ])
  const out = await listCalendarEventsInRange(db, ME, '2026-10-01', '2026-10-31')
  assert.deepEqual(out.map((e) => e.id), ['first-dawn', 'last-night'])
})

test('반복 사본 id 의 날짜는 KST 날짜다', async () => {
  const { db } = fakeDb([ev('r', '2026-10-01T23:30:00.000Z', { rrule: 'FREQ=WEEKLY' })]) // KST 10/02 08:30
  const out = await listCalendarEventsInRange(db, ME, '2026-10-01', '2026-10-10')
  assert.equal(out[0].id, 'r:2026-10-02')
})

test('월별 조회와 기간 조회 라우트가 같은 함수를 부른다', () => {
  for (const f of ['../../app/api/calendar/month/route.ts', '../../app/api/calendar/events/route.ts']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8')
    assert.match(src, /listCalendarEventsInRange\(/, f)
  }
})
