import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sweepAttendees, planApply, type SweepNote } from './attendee-sweep.ts'
import type { PersonCandidate, CompanyCandidate } from '../crm/link/attendee-link.ts'

/** 후보·회의 모두 운영 데이터 실측(2026-09-05) */
const PEOPLE: PersonCandidate[] = [
  { id: 'p-lee', name: '이기용', companyId: 'c-sook', companyName: '숙명여대', title: '교수' },
  { id: 'p-seo', name: '서명균', companyId: 'c-wooyeon', companyName: '우연컴퍼니', title: 'CEO' },
  { id: 'p-kwak', name: '곽수영', companyId: 'c-jeil', companyName: '제일엔지니어링', title: '상무' },
  { id: 'p-kimks', name: '김경수', companyId: 'c-share', companyName: '쉐어월드', title: '대표' },
]
const COMPANIES: CompanyCandidate[] = [
  { id: 'c-sook', name: '숙명여대' }, { id: 'c-wooyeon', name: '우연컴퍼니' },
  { id: 'c-jeil', name: '제일엔지니어링' }, { id: 'c-share', name: '쉐어월드' },
  { id: 'c-gcube', name: 'gcube' },
]
const CAND = { people: PEOPLE, companies: COMPANIES }

/** 실측 회의 5건 — attendees 원문 그대로 */
const NOTES: SweepNote[] = [
  { id: 'n1', title: '칠곡군 미팅- 페달스테이션', meetingAt: null,
    attendees: ['김도현', '제일엔지니어링 곽수영 상무'], linkedPersonIds: [], memberNames: ['김도현'] },
  { id: 'n2', title: '컬쳐랜드 지자체 미팅', meetingAt: null,
    attendees: ['김도현', '컬쳐랜드 김시홍팀장', '정설화 매니저', '이은지 매니저', '우연컴퍼니 서명균 대표', '컬쳐랜드 성지환 부문장'],
    linkedPersonIds: [], memberNames: ['김도현'] },
  { id: 'n3', title: '한국수자원공사 김경수 대리 전화통화', meetingAt: null,
    attendees: ['김도현', '한국수자원공사 김경수 대리'], linkedPersonIds: [], memberNames: ['김도현'] },
  { id: 'n4', title: '수원시청 시민앱 사업 관련 소개', meetingAt: null,
    attendees: ['김도현', '수원시 주무관 2명'], linkedPersonIds: [], memberNames: ['김도현'] },
  { id: 'n5', title: '수자원공사 IoT', meetingAt: null,
    attendees: ['김도현', '수자원공사 김경수 대리'], linkedPersonIds: [], memberNames: ['김도현'] },
]

test('조직원은 후보로 올리지 않는다 — 이미 다른 길로 이어져 있다', () => {
  const r = sweepAttendees(NOTES, CAND)
  const all = [...r.link, ...r.review, ...r.drop]
  assert.ok(!all.some((x) => x.raw === '김도현'), '김도현이 후보에 없어야 한다')
})

test('실측 5건을 훑으면 세 층으로 갈린다', () => {
  const r = sweepAttendees(NOTES, CAND)
  assert.equal(r.noteCount, 5)
  // 이어도 되는 것: 곽수영 · 서명균
  assert.deepEqual(r.link.map((x) => x.decision.personId).sort(), ['p-kwak', 'p-seo'])
  // 걸러낼 것: 「주무관 2명」
  assert.equal(r.drop.length, 1)
  assert.equal(r.drop[0].raw, '수원시 주무관 2명')
  // 나머지는 여쭐 것 — 김시홍 · 성지환 · 정설화 · 이은지 · 김경수 2줄
  assert.equal(r.review.length, 6)
})

test('같은 이름이 여러 회의에 나오면 한 줄로 묶고 회의는 다 남긴다', () => {
  const twice: SweepNote[] = [
    { ...NOTES[0], id: 'a', title: '첫 회의' },
    { ...NOTES[0], id: 'b', title: '둘째 회의' },
  ]
  const r = sweepAttendees(twice, CAND)
  assert.equal(r.link.length, 1, '곽수영은 한 줄')
  assert.deepEqual(r.link[0].notes.map((n) => n.title), ['첫 회의', '둘째 회의'])
})

test('이미 이어 둔 사람은 다시 묻지 않는다', () => {
  const done: SweepNote[] = [{ ...NOTES[0], linkedPersonIds: ['p-kwak'] }]
  const r = sweepAttendees(done, CAND)
  assert.equal(r.link.length, 0, '이은 다음에도 목록에 남으면 「했는데 왜 또」가 된다')
})

test('참석자가 없는 회의도 터지지 않는다', () => {
  const empty: SweepNote[] = [{ id: 'e', title: '빈 회의', meetingAt: null, attendees: [], linkedPersonIds: [], memberNames: [] }]
  const r = sweepAttendees(empty, CAND)
  assert.equal(r.link.length + r.review.length + r.drop.length, 0)
  assert.equal(r.noteCount, 1)
})

test('빈 이름·공백은 건너뛴다', () => {
  const junk: SweepNote[] = [{ id: 'j', title: 'x', meetingAt: null, attendees: ['', '   '], linkedPersonIds: [], memberNames: [] }]
  const r = sweepAttendees(junk, CAND)
  assert.equal(r.link.length + r.review.length + r.drop.length, 0)
})

/* ── 반영 계획 ────────────────────────────────────────── */

test('고른 것만 반영한다 — 안 고른 것은 계획에 없다', () => {
  const r = sweepAttendees(NOTES, CAND)
  const plan = planApply(r.link, [r.link[0].key])
  assert.equal(plan.linkExisting.length + plan.createAndLink.length, 1)
})

test('있는 인물은 잇고, 없는 인물은 만들어서 잇는다', () => {
  const r = sweepAttendees(NOTES, CAND)
  const all = [...r.link, ...r.review]
  const plan = planApply(all, all.map((x) => x.key))

  assert.equal(plan.linkExisting.length, 2, '곽수영·서명균은 있는 인물')
  assert.ok(plan.createAndLink.some((c) => c.name === '김시홍' && c.title === '팀장'),
    '없는 사람은 쪼갠 이름·직급으로 만든다')
})

test('걸러낼 것은 골라도 담지 않는다 — 「주무관 2명」이 인물이 되면 안 된다', () => {
  const r = sweepAttendees(NOTES, CAND)
  const plan = planApply([...r.link, ...r.drop], [...r.link, ...r.drop].map((x) => x.key))
  assert.ok(!plan.createAndLink.some((c) => c.name.includes('2명')))
  assert.ok(!plan.createAndLink.some((c) => c.name.includes('주무관')))
})

test('반영 계획에 그 이름이 나온 회의가 전부 들어간다', () => {
  const twice: SweepNote[] = [
    { ...NOTES[0], id: 'a' },
    { ...NOTES[0], id: 'b' },
  ]
  const r = sweepAttendees(twice, CAND)
  const plan = planApply(r.link, [r.link[0].key])
  assert.deepEqual(plan.linkExisting[0].noteIds, ['a', 'b'], '두 회의 모두에 이어야 한다')
})

test('아무것도 안 고르면 아무 일도 안 한다', () => {
  const r = sweepAttendees(NOTES, CAND)
  const plan = planApply([...r.link, ...r.review], [])
  assert.equal(plan.linkExisting.length, 0)
  assert.equal(plan.createAndLink.length, 0)
})

/* ── 실브라우저가 잡은 결함 두 개 (v0.7.691) ──────────────────
 *
 * tsc·단위테스트·design:check 가 전부 초록인데 화면에서만 보였다.
 */

test('★ 새로 만들어서 이은 사람도 다시 묻지 않는다 — 「했는데 왜 또 나오지」', () => {
  // 실측: 「슬레노 김현택 팀장」을 담아 인물을 만들었는데 목록에 그대로 남았다.
  // 새로 만든 인물은 소속이 비어 있어 다음 판정에서 company-mismatch 로 갈리고,
  // personId 가 안 잡혀 「이미 이었다」 검사를 통과해 버렸다.
  const madePerson: PersonCandidate = {
    id: 'p-new', name: '김현택', companyId: null, companyName: null, title: '팀장',
  }
  const note: SweepNote = {
    id: 'n', title: '슬레노 미팅', meetingAt: null,
    attendees: ['슬레노 김현택 팀장'], linkedPersonIds: ['p-new'], memberNames: [],
  }
  const r = sweepAttendees([note], { people: [...PEOPLE, madePerson], companies: COMPANIES })
  assert.equal(r.link.length + r.review.length + r.drop.length, 0,
    '이은 다음에도 남으면 사용자는 같은 사람을 또 만든다')
})

test('이은 것은 다른 줄의 근거 회의로도 딸려 붙지 않는다', () => {
  const madePerson: PersonCandidate = {
    id: 'p-new', name: '김현택', companyId: null, companyName: null, title: '팀장',
  }
  const notes: SweepNote[] = [
    { id: 'a', title: '아직 안 이은 회의', meetingAt: null,
      attendees: ['슬레노 김현택 팀장'], linkedPersonIds: [], memberNames: [] },
    { id: 'b', title: '이미 이은 회의', meetingAt: null,
      attendees: ['슬레노 김현택 팀장'], linkedPersonIds: ['p-new'], memberNames: [] },
  ]
  const r = sweepAttendees(notes, { people: [...PEOPLE, madePerson], companies: COMPANIES })
  const row = [...r.link, ...r.review][0]
  assert.deepEqual(row.notes.map((n) => n.id), ['a'], '이미 이은 회의가 근거로 붙으면 안 된다')
})

test('아직 안 이은 다른 회의는 그대로 묻는다 — 과교정하면 기능이 죽는다', () => {
  const notes: SweepNote[] = [
    { ...NOTES[0], id: 'a', linkedPersonIds: ['p-kwak'] },
    { ...NOTES[0], id: 'b', linkedPersonIds: [] },
  ]
  const r = sweepAttendees(notes, CAND)
  assert.equal(r.link.length, 1, '한쪽만 이었으면 나머지는 여전히 물어야 한다')
  assert.deepEqual(r.link[0].notes.map((n) => n.id), ['b'])
})
