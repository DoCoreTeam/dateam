/**
 * 오늘 미팅 + 첫 화면 포착 배선
 *
 * **왜 이 가드가 있는가**: 화면 이름이 「오늘」인데 **오늘의 미팅이 없었고**,
 * 화면 전체가 읽기 전용이라 **새 기록을 만드는 진입이 0개**였다(실측 v0.7.597).
 * 사용자 지시(2026-08-27): *"첫 화면에서 바로 뭔가 입력을 할 수 있어야 한다"*.
 *
 * 배선은 정적으로 잠근다 — "만들었는데 안 꽂아 없는 기능이 되던" 전례가 이 저장소에 여럿 있다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { listTodayMeetings } from './today-meetings.ts'

const TODAY_UI = readFileSync(new URL('../../../app/(crm)/crm/today/TodayClient.tsx', import.meta.url), 'utf8')
const TODAY_API = readFileSync(new URL('../../../app/api/crm/today/route.ts', import.meta.url), 'utf8')
const BOX = readFileSync(new URL('../../../components/crm/MeetingIntakeBox.tsx', import.meta.url), 'utf8')

/** 지정한 행만 돌려주는 가짜 DB — where 를 실제로 해석해 경계를 검증한다 */
function fakeDb(rows: { id: string; title: string; startedAt: string; summaryMd?: string | null; noteId?: string | null; companyId?: string | null }[],
                companies: Record<string, string> = {}) {
  return {
    crmMeeting: {
      findMany: async ({ where, take }: { where: { startedAt: { gte: Date; lte: Date } }; take: number }) => rows
        .filter((r) => {
          const t = new Date(r.startedAt).getTime()
          return t >= where.startedAt.gte.getTime() && t <= where.startedAt.lte.getTime()
        })
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        .slice(0, take)
        .map((r) => ({
          id: r.id, title: r.title, startedAt: new Date(r.startedAt),
          summaryMd: r.summaryMd ?? null, noteId: r.noteId ?? null, companyId: r.companyId ?? null,
        })),
    },
    crmCompany: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => companies[id]).map((id) => ({ id, name: companies[id] })),
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const NOON_KST = new Date('2026-08-27T03:00:00.000Z')  // KST 12:00

test('오늘(KST) 안의 미팅만 나온다', async () => {
  const db = fakeDb([
    { id: 'a', title: '어제', startedAt: '2026-08-26T05:00:00.000Z' },
    { id: 'b', title: '오늘 14시', startedAt: '2026-08-27T05:00:00.000Z' },
    { id: 'c', title: '내일', startedAt: '2026-08-28T05:00:00.000Z' },
  ])
  const rows = await listTodayMeetings(db, NOON_KST)
  assert.deepEqual(rows.map((r) => r.id), ['b'])
})

test('★ KST 하루 끝 경계를 놓치지 않는다 — 23:59 미팅', async () => {
  // 23:59:59.999 KST = 14:59:59.999 UTC. `lt` 로 걸면 이 건이 사라진다
  const db = fakeDb([{ id: 'late', title: '23:59', startedAt: '2026-08-27T14:59:00.000Z' }])
  const rows = await listTodayMeetings(db, NOON_KST)
  assert.deepEqual(rows.map((r) => r.id), ['late'])
})

test('★ KST 하루 시작 경계 — 00:00 미팅 (UTC 로는 전날 15:00)', async () => {
  const db = fakeDb([{ id: 'early', title: '00:00', startedAt: '2026-08-26T15:00:00.000Z' }])
  const rows = await listTodayMeetings(db, NOON_KST)
  assert.deepEqual(rows.map((r) => r.id), ['early'])
})

test('이른 시각이 위 — 하루를 시간 순으로 읽는다', async () => {
  const db = fakeDb([
    { id: 'pm', title: '오후', startedAt: '2026-08-27T07:00:00.000Z' },
    { id: 'am', title: '오전', startedAt: '2026-08-27T00:30:00.000Z' },
  ])
  assert.deepEqual((await listTodayMeetings(db, NOON_KST)).map((r) => r.id), ['am', 'pm'])
})

test('회사 이름을 한 번에 붙인다 — 건당 조회하면 하나만 실패해도 그 줄이 빈다', async () => {
  const db = fakeDb(
    [{ id: 'x', title: '킥오프', startedAt: '2026-08-27T05:00:00.000Z', companyId: 'c1' }],
    { c1: '○○전자' },
  )
  assert.equal((await listTodayMeetings(db, NOON_KST))[0].companyName, '○○전자')
})

test('요약도 원본 노트도 없으면 「기록 없음」으로 판정된다', async () => {
  const db = fakeDb([
    { id: 'empty', title: '아직', startedAt: '2026-08-27T01:00:00.000Z' },
    { id: 'has', title: '적힘', startedAt: '2026-08-27T02:00:00.000Z', noteId: 'n1' },
  ])
  const rows = await listTodayMeetings(db, NOON_KST)
  assert.equal(rows.find((r) => r.id === 'empty')!.empty, true)
  assert.equal(rows.find((r) => r.id === 'has')!.empty, false)
})

test('상한을 넘기지 않는다 — 목록이 상자를 잡아먹으면 안 된다', async () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    id: `m${i}`, title: `m${i}`,
    startedAt: `2026-08-27T0${i % 9}:00:00.000Z`,
  }))
  assert.equal((await listTodayMeetings(fakeDb(many), NOON_KST)).length, 5)
})

/* ── 배선 — 만들고 안 꽂으면 없는 기능이다 ────────────────────── */

test('★ 첫 화면이 포착 상자를 실제로 그린다', () => {
  assert.match(TODAY_UI, /import MeetingIntakeBox/, '포착 상자를 import 하지 않는다')
  assert.match(TODAY_UI, /<MeetingIntakeBox/, 'import 만 하고 안 그린다')
})

test('★ 포착이 맨 위다 — 노트북을 펼친 사람이 먼저 찾는 것은 「어디에 적지」다', () => {
  const box = TODAY_UI.indexOf('<MeetingIntakeBox')
  assert.ok(box > 0, '포착 상자가 없다')
  // 이 화면에서 포착보다 위에 올 수 있는 것은 인사말뿐이다
  for (const below of ['unplanned > 0', 'aiPicks', 'items.map']) {
    const at = TODAY_UI.indexOf(below)
    if (at > 0) assert.ok(box < at, `포착 상자가 ${below} 아래로 밀렸다`)
  }
})

test('걷어낸 「시작하기」가 되살아나지 않는다 — 한 번 하고 끝나는 안내는 상주하지 않는다', () => {
  assert.ok(!/setup/i.test(TODAY_UI), '첫 화면에 시작하기가 되돌아왔다')
  assert.ok(!/setup/i.test(TODAY_API), '서버가 아직 시작하기를 보낸다')
})

test('★ 서버가 오늘 미팅을 실제로 보낸다', () => {
  assert.match(TODAY_API, /listTodayMeetings/, 'API 가 오늘 미팅을 안 읽는다')
  assert.match(TODAY_API, /todayMeetings,/, '읽고서 응답에 안 담는다')
})

test('★ 한 번 누르면 곧장 작업대 — 제목·시각을 묻지 않는다', () => {
  assert.match(BOX, /startMeeting\(\)/, '진입 SSOT 를 안 쓴다')
  assert.ok(!/제목|시각을 입력/.test(BOX.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')),
    '회의 중에 폼을 묻고 있다')
})

test('★ 말은 용어집이 정한다 — 화면에 한글 라벨을 직접 안 적는다', () => {
  assert.match(BOX, /MEETING_CAPTURE_LABEL/, '「미팅 기록」을 문자열로 적었다')
  assert.match(BOX, /from '@\/lib\/terms'/, '용어집을 안 쓴다')
})

test('오늘 잡힌 미팅은 새로 만들지 않고 이어간다', () => {
  assert.match(BOX, /meetingHref\(m\.id\)/, '후보를 눌러도 그 미팅으로 안 간다')
})
