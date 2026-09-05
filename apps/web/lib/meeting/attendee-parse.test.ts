import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAttendee, parseAttendees } from './attendee-parse.ts'

/**
 * 표본은 전부 **운영 데이터에서 그대로 가져온 것**이다(2026-09-05 · meeting_notes.attendees 18건).
 * 지어낸 입력으로 통과시키면 실제 데이터에서 또 깨진다.
 */

test('회사 + 이름 + 직급이 공백으로 나뉜 것', () => {
  const p = parseAttendee('제일엔지니어링 곽수영 상무')
  assert.equal(p.kind, 'person')
  assert.equal(p.company, '제일엔지니어링')
  assert.equal(p.name, '곽수영')
  assert.equal(p.title, '상무')
})

test('직급이 이름에 붙어 있어도 뗀다 — 실측 「컬쳐랜드 김시홍팀장」', () => {
  const p = parseAttendee('컬쳐랜드 김시홍팀장')
  assert.equal(p.kind, 'person')
  assert.equal(p.company, '컬쳐랜드')
  assert.equal(p.name, '김시홍')
  assert.equal(p.title, '팀장')
})

test('회사 없이 이름 + 직급', () => {
  const p = parseAttendee('진경선 교수')
  assert.equal(p.kind, 'person')
  assert.equal(p.company, null)
  assert.equal(p.name, '진경선')
  assert.equal(p.title, '교수')
})

test('이름만 있는 것', () => {
  const p = parseAttendee('김도현')
  assert.equal(p.kind, 'person')
  assert.equal(p.company, null)
  assert.equal(p.name, '김도현')
  assert.equal(p.title, null)
})

test('긴 회사 이름도 이름은 뒤에서 찾는다', () => {
  const p = parseAttendee('한국수자원공사 김경수 대리')
  assert.equal(p.company, '한국수자원공사')
  assert.equal(p.name, '김경수')
  assert.equal(p.title, '대리')
})

test('인원수 표기는 이름이 아니다 — 실측 「수원시 주무관 2명」', () => {
  const p = parseAttendee('수원시 주무관 2명')
  assert.equal(p.kind, 'count')
  assert.equal(p.name, '수원시 주무관 2명', '원문을 잃지 않는다')
})

test('긴 직급을 짧은 직급으로 자르지 않는다', () => {
  assert.equal(parseAttendee('컬쳐랜드 성지환 부문장').title, '부문장')
  assert.equal(parseAttendee('컬쳐랜드 성지환 부문장').name, '성지환')
  assert.equal(parseAttendee('가나기업 홍길동 본부장').title, '본부장')
  assert.equal(parseAttendee('가나기업 홍길동 본부장').company, '가나기업')
})

test('호칭 「님」 「씨」는 이름에서 뗀다', () => {
  assert.equal(parseAttendee('홍길동님').name, '홍길동')
  assert.equal(parseAttendee('가나기업 홍길동씨').name, '홍길동')
  assert.equal(parseAttendee('가나기업 홍길동씨').company, '가나기업')
})

test('직급만 적힌 것은 이름으로 만들지 않는다', () => {
  const p = parseAttendee('팀장')
  assert.notEqual(p.kind, 'person')
  assert.equal(p.name, '팀장', '원문 보존')
})

test('이름으로 보기 어려우면 unknown — 지어내지 않는다', () => {
  const p = parseAttendee('영업본부 전략기획실')
  assert.equal(p.kind, 'unknown')
})

test('영문 이름도 사람으로 본다', () => {
  const p = parseAttendee('Acme John Doe')
  assert.equal(p.kind, 'person')
  assert.equal(p.name, 'Doe')
})

test('빈 문자열·공백은 unknown 이고 터지지 않는다', () => {
  assert.equal(parseAttendee('').kind, 'unknown')
  assert.equal(parseAttendee('   ').kind, 'unknown')
})

test('연속 공백을 한 칸으로 모은다', () => {
  const p = parseAttendee('  컬쳐랜드   김시홍   팀장 ')
  assert.equal(p.company, '컬쳐랜드')
  assert.equal(p.name, '김시홍')
  assert.equal(p.title, '팀장')
})

test('원문은 언제나 그대로 남는다 — 되짚을 수 있어야 한다', () => {
  const raw = '  컬쳐랜드 김시홍팀장 '
  assert.equal(parseAttendee(raw).raw, raw)
})

test('parseAttendees — 실측 18건의 외부인 이름을 전부 처리한다', () => {
  const rows = parseAttendees([
    '경북본부 배수현 팀장',
    '경북본부 구유빈 대리',
    '수원시 주무관 2명',
    '수자원공사 김경수 대리',
    '숙명여대 이기용 교수',
    '슬레노 김현택 팀장',
    '우연컴퍼니 서명균 대표',
    '이은지 매니저',
    '정설화 매니저',
    '제일엔지니어링 곽수영 상무',
    '진경선 교수',
    '컬쳐랜드 김시홍팀장',
    '컬쳐랜드 성지환 부문장',
    '한국수자원공사 김경수 대리',
  ])
  assert.equal(rows.length, 14)
  assert.equal(rows.filter((r) => r.kind === 'person').length, 13, '13명은 이름을 뽑는다')
  assert.equal(rows.filter((r) => r.kind === 'count').length, 1, '「주무관 2명」 하나만 인원수')
  // 회사가 붙은 것과 안 붙은 것이 섞여 있다 — 둘 다 정상이다
  assert.equal(rows.find((r) => r.raw === '이은지 매니저')?.company, null)
  assert.equal(rows.find((r) => r.raw === '슬레노 김현택 팀장')?.company, '슬레노')
})

test('빈 줄은 걸러낸다', () => {
  assert.equal(parseAttendees(['김도현', '  ', '']).length, 1)
})
