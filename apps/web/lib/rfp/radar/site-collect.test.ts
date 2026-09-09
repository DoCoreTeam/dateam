import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractLinks, absolute, renderPage, buildSitePrompt, parseSiteNotices,
  noticesFromLinks, toSourceRows, fetchPage, MAX_NOTICES,
} from './site-collect.ts'

const HTML = `
<html><body>
<ul class="board">
  <li><a href="/bbs/view.do?id=101">2026년 차세대 통합정보시스템 구축 사업 입찰공고</a> <span>2026-09-01</span></li>
  <li><a href="/bbs/view.do?id=102">데이터 플랫폼 유지관리 용역 재공고</a> <span>2026-09-03</span></li>
  <li><a href="/bbs/list.do?page=2">다음</a></li>
</ul>
</body></html>`

test('링크에서 제목과 상세 주소를 뽑는다 — 주소를 잃으면 사람이 다시 찾아야 한다', () => {
  const links = extractLinks(HTML, 'https://example.go.kr/')
  assert.equal(links.length, 2)   // 「다음」은 두 글자라 빠진다
  assert.ok(links[0].text.includes('차세대'))
  assert.equal(links[0].href, 'https://example.go.kr/bbs/view.do?id=101')
})

test('상대 주소를 절대 주소로 — 상대인 채로 저장하면 나중에 못 연다', () => {
  assert.equal(absolute('/a/b', 'https://x.go.kr/list'), 'https://x.go.kr/a/b')
  assert.equal(absolute('https://y.go.kr/a', 'https://x.go.kr/'), 'https://y.go.kr/a')
  // 기준이 없으면 그대로 둔다(버리지 않는다)
  assert.equal(absolute('/a', undefined), '/a')
})

test('AI 에게 링크 목록과 쪽 글자를 함께 준다', () => {
  const body = renderPage(HTML, extractLinks(HTML, 'https://x.go.kr/'))
  assert.ok(body.includes('링크 목록'))
  assert.ok(body.includes('쪽 글자'))
  assert.ok(body.includes('차세대'))
  // 태그는 없어야 한다
  assert.equal(body.includes('<li>'), false)
})

test('프롬프트가 공지·메뉴를 빼라고 말한다', () => {
  const p = buildSitePrompt('본문')
  assert.ok(p.includes('공지·안내·메뉴·페이지 번호는 공고가 아니다'))
  assert.ok(p.includes('만들어 내지 않는다'))
})

test('링크 목록에 없는 주소는 버린다 — 지어낸 주소는 눌러도 안 열린다', () => {
  const links = extractLinks(HTML, 'https://x.go.kr/')
  const rows = parseSiteNotices(JSON.stringify({
    notices: [
      { title: '진짜 공고', url: links[0].href },
      { title: '지어낸 공고', url: 'https://x.go.kr/does-not-exist' },
    ],
  }), links)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].url, links[0].href)
  assert.equal(rows[1].url, null)   // 버리되 제목은 남긴다
})

test('제목 없는 줄은 버린다', () => {
  assert.equal(parseSiteNotices(JSON.stringify({ notices: [{ url: 'x' }, { title: '가나다' }] }), []).length, 1)
})

test('날짜 모양이 아니면 버린다 — 정렬이 깨진다', () => {
  const [a] = parseSiteNotices(JSON.stringify({ notices: [{ title: 'x', noticeDate: '2026년 9월 1일' }] }), [])
  assert.equal(a.noticeDate, '2026-09-01')
  const [b] = parseSiteNotices(JSON.stringify({ notices: [{ title: 'x', noticeDate: '다음 주' }] }), [])
  assert.equal(b.noticeDate, null)
})

test('JSON 이 아니면 빈 배열 — 훑기 전체가 죽지 않는다', () => {
  assert.deepEqual(parseSiteNotices('못 하겠습니다', []), [])
})

test('AI 없이도 링크만으로 뽑는다 — 「아무것도 안 됨」이 되면 안 된다', () => {
  const rows = noticesFromLinks(extractLinks(HTML, 'https://x.go.kr/'))
  assert.equal(rows.length, 2)
  assert.ok(rows[0].url)
})

test('조작 단추는 공고가 아니다', () => {
  const rows = noticesFromLinks([
    { text: '목록', href: '/a' }, { text: '더보기', href: '/b' },
    { text: '차세대 통합정보시스템 구축 사업', href: '/c' },
  ])
  assert.equal(rows.length, 1)
})

test('공고번호가 없으면 주소가 그 자리를 대신한다 — 중복 판정에 쓰인다', () => {
  const [row] = toSourceRows([{
    title: '가', noticeNo: null, agency: null, budgetAmount: null, noticeDate: null,
    url: 'https://x.go.kr/1',
  }], 'org', '어느 기관')
  assert.equal(row.notice_no, 'https://x.go.kr/1')
  assert.equal(row.source_system, 'agency')
  assert.equal(row.announcing_agency, '어느 기관')
})

test('쪽을 못 받아도 값으로 돌려준다 — 한 사이트가 죽었다고 훑기가 멈추면 안 된다', async () => {
  const r = await fetchPage('https://x', async () => ({ ok: false, status: 503 } as Response))
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'http_503')
})

test('사람이 보는 것과 같은 쪽을 받는다 — 기본 UA 를 막는 기관이 있다', async () => {
  let ua = ''
  await fetchPage('https://x', async (_u, init) => {
    ua = String((init?.headers as Record<string, string>)?.['user-agent'] ?? '')
    return { ok: true, status: 200, text: async () => '<html></html>' } as Response
  })
  assert.ok(ua.length > 0)
  assert.ok(MAX_NOTICES > 0)
})
