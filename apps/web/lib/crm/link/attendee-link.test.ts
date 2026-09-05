import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAttendee } from '../../meeting/attendee-parse.ts'
import { linkAttendee, linkAttendees, groupByTier, isOwnOrg, type PersonCandidate, type CompanyCandidate } from './attendee-link.ts'

/**
 * 후보는 **운영 데이터 그대로**다(2026-09-05 · crm_person 209명 · crm_company 380곳 중 관련분).
 * 지어낸 후보로 통과시키면 실제 데이터에서 또 갈린다.
 */
const PEOPLE: PersonCandidate[] = [
  { id: 'p-lee', name: '이기용', companyId: 'c-sook', companyName: '숙명여대', title: '교수' },
  { id: 'p-seo', name: '서명균', companyId: 'c-wooyeon', companyName: '우연컴퍼니', title: 'CEO' },
  { id: 'p-kwak', name: '곽수영', companyId: 'c-jeil', companyName: '제일엔지니어링', title: '상무' },
  { id: 'p-kimks', name: '김경수', companyId: 'c-share', companyName: '쉐어월드', title: '대표' },
  { id: 'p-kimbs', name: '김범석', companyId: 'c-yj', companyName: '영진기술', title: '과장' },
  // 실측 동명이인 — CRM 에 「김지훈」이 2명 있다(파트리지시스템즈 · 윈스)
  { id: 'p-kimjh1', name: '김지훈', companyId: 'c-partridge', companyName: '파트리지시스템즈', title: 'Chief Operation Offi' },
  { id: 'p-kimjh2', name: '김지훈', companyId: 'c-wins', companyName: '윈스', title: '수석' },
]
const COMPANIES: CompanyCandidate[] = [
  { id: 'c-sook', name: '숙명여대' },
  { id: 'c-wooyeon', name: '우연컴퍼니' },
  { id: 'c-jeil', name: '제일엔지니어링' },
  { id: 'c-share', name: '쉐어월드' },
  { id: 'c-yj', name: '영진기술' },
  { id: 'c-kisc', name: '한국산업단지공단' },
  { id: 'c-kisc-gb', name: '한국산업단지공단 경북본부' },
  { id: 'c-partridge', name: '파트리지시스템즈' },
  { id: 'c-wins', name: '윈스' },
  // 실측 동명 회사 — 표기만 다른 두 벌이 CRM 에 함께 있다
  { id: 'c-talos1', name: '탈로스' },
  { id: 'c-talos2', name: '(주)탈로스' },
  { id: 'c-gcube', name: 'gcube' },
]
const CAND = { people: PEOPLE, companies: COMPANIES }

const decide = (raw: string) => linkAttendee(parseAttendee(raw), CAND)

/* ── 이어도 되는 것 ────────────────────────────────────── */

test('이름과 소속이 맞으면 잇는다', () => {
  const d = decide('숙명여대 이기용 교수')
  assert.equal(d.tier, 'link')
  assert.equal(d.reason, 'exact-one')
  assert.equal(d.personId, 'p-lee')
})

test('소속을 안 적었어도 그 이름이 한 명뿐이면 잇는다', () => {
  const d = decide('곽수영 상무')
  assert.equal(d.tier, 'link')
  assert.equal(d.reason, 'name-only-one')
  assert.equal(d.personId, 'p-kwak')
})

test('CRM 에 없는 사람이라도 회사가 하나로 정해지면 새 인물로 만든다', () => {
  const d = decide('영진기술 박신입 사원')
  assert.equal(d.tier, 'link')
  assert.equal(d.reason, 'new-person')
  assert.equal(d.personId, null, '기존 인물이 아니다')
  assert.equal(d.companyId, 'c-yj', '소속은 정해졌다')
})

test('표기가 흔들려도 같은 회사로 본다 — name-match 와 같은 규칙', () => {
  const d = decide('(주)제일엔지니어링 곽수영 상무')
  assert.equal(d.tier, 'link')
  assert.equal(d.personId, 'p-kwak')
})

/* ── 여쭐 것 ──────────────────────────────────────────── */

test('이름은 같은데 소속이 다르면 잇지 않는다 — 실측 김경수 건', () => {
  const d = decide('한국수자원공사 김경수 대리')
  assert.equal(d.tier, 'review')
  assert.equal(d.reason, 'company-mismatch')
  assert.equal(d.personId, null, '엉뚱한 사람에게 회의를 붙이지 않는다')
  assert.equal(d.people[0].id, 'p-kimks', '판단 재료로 그 사람을 보여 준다')
})

test('회사 후보가 표기만 다른 두 벌이면 고르지 않는다 — 실측 「탈로스 / (주)탈로스」', () => {
  const d = decide('탈로스 홍길동 팀장')
  assert.equal(d.tier, 'review')
  assert.equal(d.reason, 'company-ambiguous')
  assert.equal(d.companies.length, 2, '둘 다 보여 주고 사람이 고른다')
})

test('회사 이름을 줄여 적으면 못 찾는다 — 실측 「경북본부」 vs CRM 「한국산업단지공단 경북본부」', () => {
  const d = decide('경북본부 배수현 팀장')
  assert.equal(d.tier, 'review')
  assert.equal(d.reason, 'company-unknown')
  assert.equal(d.parsed.company, '경북본부', '무엇으로 찾았는지는 남긴다')
})

test('회사 이름이 정확히 하나로 맞으면 새 인물로 잇는다', () => {
  const d = decide('한국산업단지공단 홍길동 팀장')
  assert.equal(d.tier, 'link')
  assert.equal(d.reason, 'new-person')
  assert.equal(d.companyId, 'c-kisc')
})

test('같은 이름이 여럿이면 사람이 고른다 — 실측 「김지훈」 2명', () => {
  const d = decide('김지훈 수석')
  assert.equal(d.tier, 'review')
  assert.equal(d.reason, 'homonym')
  assert.equal(d.people.length, 2)
})

test('같은 이름이 여럿이어도 소속이 적혀 있으면 좁혀진다', () => {
  const d = decide('윈스 김지훈 수석')
  assert.equal(d.tier, 'link')
  assert.equal(d.personId, 'p-kimjh2')
})

test('CRM 에 없는 회사면 사람에게 묻는다 — 실측 슬레노·컬쳐랜드', () => {
  assert.equal(decide('슬레노 김현택 팀장').reason, 'company-unknown')
  assert.equal(decide('컬쳐랜드 김시홍팀장').tier, 'review')
})

test('소속을 안 적었고 CRM 에도 없으면 묻는다', () => {
  const d = decide('정설화 매니저')
  assert.equal(d.tier, 'review')
  assert.equal(d.reason, 'company-unknown')
})

/* ── 걸러낼 것 ────────────────────────────────────────── */

test('인원수 표기는 버린다 — 실측 「수원시 주무관 2명」', () => {
  const d = decide('수원시 주무관 2명')
  assert.equal(d.tier, 'drop')
  assert.equal(d.reason, 'not-a-person')
})

test('우리 조직은 거래처로 세지 않는다 — 실측 gcube 가 회사로 등록돼 있다', () => {
  assert.equal(decide('gcube 홍길동 팀장').tier, 'drop')
  assert.equal(decide('gcube 홍길동 팀장').reason, 'own-org')
  assert.equal(decide('데이터얼라이언스 홍길동 팀장').reason, 'own-org')
})

test('isOwnOrg 는 표기 흔들림을 흡수한다', () => {
  assert.equal(isOwnOrg('gcube'), true)
  assert.equal(isOwnOrg('GCube'), true)
  assert.equal(isOwnOrg('(주)데이터얼라이언스'), true)
  assert.equal(isOwnOrg('영진기술'), false)
  assert.equal(isOwnOrg(null), false)
})

/* ── 묶음 ─────────────────────────────────────────────── */

test('실측 14명을 세 층으로 가른다 — 여쭐 것만 남아야 한다', () => {
  const raws = [
    '경북본부 배수현 팀장', '경북본부 구유빈 대리', '수원시 주무관 2명',
    '수자원공사 김경수 대리', '숙명여대 이기용 교수', '슬레노 김현택 팀장',
    '우연컴퍼니 서명균 대표', '이은지 매니저', '정설화 매니저',
    '제일엔지니어링 곽수영 상무', '진경선 교수', '컬쳐랜드 김시홍팀장',
    '컬쳐랜드 성지환 부문장', '한국수자원공사 김경수 대리',
  ]
  const g = groupByTier(linkAttendees(raws.map(parseAttendee), CAND))

  // 이어도 되는 것: 이기용(숙명여대) · 서명균(우연컴퍼니) · 곽수영(제일엔지니어링)
  assert.equal(g.link.length, 3)
  assert.deepEqual(g.link.map((d) => d.personId).sort(), ['p-kwak', 'p-lee', 'p-seo'])

  // 걸러낼 것: 「주무관 2명」 하나
  assert.equal(g.drop.length, 1)

  // 나머지는 전부 사람이 본다 — 그리고 그 안에 김경수 두 줄이 다 들어 있다
  assert.equal(g.review.length, 10)
  assert.equal(g.review.filter((d) => d.reason === 'company-mismatch').length, 2, '김경수 2줄')
})

test('빈 후보로도 터지지 않는다 — CRM 조회가 실패해도 화면은 살아야 한다', () => {
  const d = linkAttendee(parseAttendee('숙명여대 이기용 교수'), { people: [], companies: [] })
  assert.equal(d.tier, 'review')
  assert.equal(d.reason, 'company-unknown')
})
