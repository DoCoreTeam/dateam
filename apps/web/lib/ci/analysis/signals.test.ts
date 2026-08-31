// lib/ci/analysis/signals.test.ts — 이슈 후보를 받아들이는 규칙 가드

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  signalDedupeKey, parseSignalCandidates, resolveSignalQueries,
  buildSignalPrompt, signalConfidence, SIGNAL_CANDIDATE_MAX,
} from './signals.ts'

const TOPICS = [{ id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', name: '격투/피지컬' }]

test('★ 출처 주소가 없으면 후보를 만들지 않는다 — 확인할 수 없는 줄은 목록만 어지럽힌다', () => {
  const out = parseSignalCandidates(JSON.stringify({
    signals: [
      { kind: 'news', title: '출처 없는 소문' },
      { kind: 'news', title: '출처 있는 뉴스', url: 'https://news.example.com/a/1' },
    ],
  }), TOPICS)
  assert.equal(out.length, 1)
  assert.equal(out[0].title, '출처 있는 뉴스')
})

test('★ 같은 주소는 한 번만 — 추적 파라미터가 붙어도 같은 기사다', () => {
  const out = parseSignalCandidates(JSON.stringify({
    signals: [
      { kind: 'news', title: 'A', url: 'https://news.example.com/a/1?utm_source=x' },
      { kind: 'news', title: 'A 복제', url: 'https://www.news.example.com/a/1/' },
    ],
  }), TOPICS)
  assert.equal(out.length, 1, '같은 기사가 두 줄이 되면 후보함이 금방 못 읽게 된다')
})

test('중복 열쇠는 스킴·www·쿼리·해시·끝 슬래시를 무시한다', () => {
  assert.equal(signalDedupeKey('https://www.a.com/b/c/?x=1#z'), 'a.com/b/c')
  assert.equal(signalDedupeKey('http://a.com/b/c'), 'a.com/b/c')
  assert.equal(signalDedupeKey('a.com'), 'a.com')
})

test('주소가 아니면 열쇠도 없다 — 후보가 만들어지지 않는다', () => {
  for (const bad of ['', '   ', 'javascript:alert(1)', '홈페이지없음']) {
    assert.equal(signalDedupeKey(bad), null, `열쇠가 생기면 안 된다: ${bad}`)
  }
})

test('★ 후보 목록에 없는 주제 id 는 버린다 — 환각 id 가 남의 주제 통계를 오염시킨다', () => {
  const out = parseSignalCandidates(JSON.stringify({
    signals: [{ kind: 'news', title: 'A', url: 'https://a.com/1', topicId: '지어낸-id' }],
  }), TOPICS)
  assert.equal(out[0].topicId, null)
})

test('주제까지 정해지면 확신도가 높다 — 사람이 바로 확정할 만하다', () => {
  assert.ok(signalConfidence(true) > signalConfidence(false))
})

test('날짜 형식이 틀리면 null — 사건 시각을 지어내지 않는다', () => {
  const out = parseSignalCandidates(JSON.stringify({
    signals: [
      { kind: 'news', title: 'A', url: 'https://a.com/1', occurredDate: '2026/08/30' },
      { kind: 'news', title: 'B', url: 'https://a.com/2', occurredDate: '2026-08-30' },
    ],
  }), TOPICS)
  assert.equal(out[0].occurredDate, null)
  assert.equal(out[1].occurredDate, '2026-08-30')
})

test('모르는 종류는 뉴스로 접는다 — 목록 밖 값이 DB 제약을 깨지 않게', () => {
  const out = parseSignalCandidates(JSON.stringify({
    signals: [{ kind: '루머', title: 'A', url: 'https://a.com/1' }],
  }), TOPICS)
  assert.equal(out[0].kind, 'news')
})

test('코드펜스로 감싸 와도 읽고, 깨진 응답은 빈 배열이다', () => {
  const fenced = '```json\n{"signals":[{"kind":"news","title":"A","url":"https://a.com/1"}]}\n```'
  assert.equal(parseSignalCandidates(fenced, TOPICS).length, 1)
  assert.deepEqual(parseSignalCandidates('이건 JSON이 아닙니다', TOPICS), [])
})

test('★ 한 번에 받는 후보에 상한이 있다 — 수십 건이 쌓이면 사람이 목록 전체를 안 본다', () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    ({ kind: 'news', title: `A${i}`, url: `https://a.com/${i}` }))
  const out = parseSignalCandidates(JSON.stringify({ signals: many }), TOPICS)
  assert.equal(out.length, SIGNAL_CANDIDATE_MAX)
})

test('검색어는 설정이 이기고, 없으면 주제 이름을 쓴다', () => {
  assert.deepEqual(resolveSignalQueries('격투기, 예능', TOPICS), ['격투기', '예능'])
  assert.deepEqual(resolveSignalQueries('', TOPICS), ['격투/피지컬'])
  assert.deepEqual(resolveSignalQueries('', []), [], '찾을 거리가 없으면 억지로 찾지 않는다')
})

test('★ 프롬프트가 출처 필수·지어내기 금지·빈 배열 허용을 못 박는다', () => {
  const prompt = buildSignalPrompt({
    queries: ['격투기'], topics: TOPICS, todayKst: '2026-08-31', windowDays: 7,
  })
  assert.match(prompt, /출처 주소\(url\)가 없으면 넣지 않는다/)
  assert.match(prompt, /기억으로 답하지 않는다/)
  assert.match(prompt, /지어내지 않는다/)
  assert.match(prompt, /빈 배열이 정답/)
  assert.match(prompt, /2026-08-31/, '오늘이 언제인지 안 주면 「최근」을 판단할 수 없다')
  assert.ok(prompt.includes(TOPICS[0].id), '주제 id 를 안 주면 어디에 담을지 고를 수 없다')
})
