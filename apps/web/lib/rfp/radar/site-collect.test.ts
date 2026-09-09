import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractLinks, absolute, renderPage, buildSitePrompt, parseSiteNotices,
  noticesFromLinks, pickNoticeGroup, urlShape, looksDetail, cleanTitle, dateFromRow,
  sourceKey, toSourceRows, fetchPage, MAX_NOTICES,
} from './site-collect.ts'

const HTML = `
<html><body>
<ul class="board">
  <li><a href="/bbs/view.do?id=101">2026년 차세대 통합정보시스템 구축 사업 입찰공고</a> <span>2026-09-01</span></li>
  <li><a href="/bbs/view.do?id=102">데이터 플랫폼 유지관리 용역 재공고</a> <span>2026-09-03</span></li>
  <li><a href="/bbs/list.do?page=2">다음</a></li>
</ul>
</body></html>`

/** 규칙만으로 뽑을 때 쓰는 것 — 목록은 같은 모양의 주소가 여럿이다 */
const LIST_HTML = `
<ul>
  <li><a href="/bbs/view.do?id=101">2026년 차세대 통합정보시스템 구축 사업 입찰공고</a></li>
  <li><a href="/bbs/view.do?id=102">데이터 플랫폼 유지관리 용역 재공고</a></li>
  <li><a href="/bbs/view.do?id=103">클라우드 전환 컨설팅 용역 입찰공고</a></li>
  <li><a href="/about/intro.do?menu=1">기관 소개 페이지입니다</a></li>
</ul>`

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
  const rows = noticesFromLinks(extractLinks(LIST_HTML, 'https://x.go.kr/'))
  assert.equal(rows.length, 3)
  assert.ok(rows[0].url)
})

test('메뉴를 공고로 담지 않는다 — 실측 NIA 에서 50건 중 대부분이 내비게이션이었다', () => {
  const links = [
    { text: '인공지능융합본부', href: 'https://x.go.kr/ex/bbs/ListBusiness.do?businessMnCd=23001000' },
    { text: '전체메뉴 바로가기', href: 'https://x.go.kr/#gnb_menu' },
    { text: '팝업 알림 닫기', href: 'https://x.go.kr/#' },
    { text: '한국지능정보사회진흥원 소개', href: 'https://x.go.kr/site/main.do' },
  ]
  assert.deepEqual(noticesFromLinks(links), [])
})

test('같은 모양의 주소가 여럿이면 그것이 목록이다', () => {
  const group = pickNoticeGroup([
    { text: '차세대 통합정보시스템 구축 사업', href: 'https://x.go.kr/bbs/View.do?id=101' },
    { text: '데이터 플랫폼 유지관리 용역', href: 'https://x.go.kr/bbs/View.do?id=102' },
    { text: '클라우드 전환 컨설팅 사업', href: 'https://x.go.kr/bbs/View.do?id=103' },
    { text: '기관 소개 페이지입니다', href: 'https://x.go.kr/about/intro.do?menu=1' },
  ])
  assert.equal(group.length, 3)
  assert.ok(group.every((l) => l.href.includes('View.do')))
})

test('무리가 작으면 아무것도 안 담는다 — 쓰레기 한 줄이 알림으로 나간다', () => {
  assert.deepEqual(noticesFromLinks([
    { text: '어쩌다 하나 있는 긴 링크입니다', href: 'https://x.go.kr/a.do?id=1' },
  ]), [])
})

test('큰 무리가 아니라 상세로 가는 무리를 고른다 — 실측에서 사이드바 게시판 목록이 공고로 담겼다', () => {
  const links = [
    // 사이드바: 게시판 목록으로 가는 링크가 더 많다
    { text: '국가지능정보화백서', href: 'https://x.go.kr/bbs/List.do?cbIdx=44086' },
    { text: '정보화정책 저널입니다', href: 'https://x.go.kr/bbs/List.do?cbIdx=65684' },
    { text: '인터넷이용실태조사', href: 'https://x.go.kr/bbs/List.do?cbIdx=99870' },
    { text: '웹 접근성 실태조사', href: 'https://x.go.kr/bbs/List.do?cbIdx=99873' },
    // 본문: 공고 상세로 가는 링크
    { text: '차세대 통합정보시스템 구축 사업 입찰공고', href: 'https://x.go.kr/bbs/View.do?bbsIdx=1' },
    { text: '데이터 플랫폼 유지관리 용역 재공고', href: 'https://x.go.kr/bbs/View.do?bbsIdx=2' },
    { text: '클라우드 전환 컨설팅 용역 공고', href: 'https://x.go.kr/bbs/View.do?bbsIdx=3' },
  ]
  const group = pickNoticeGroup(links)
  assert.equal(group.length, 3)
  assert.ok(group.every((l) => l.href.includes('View.do')), group.map((l) => l.href).join(','))
})

test('자바스크립트 게시판은 제목만 건진다 — 실측 NIA 는 줄마다 href="#view" 다', () => {
  const links = [
    { text: '차세대 통합정보시스템 구축 사업 입찰공고', href: '#view' },
    { text: '데이터 플랫폼 유지관리 용역 재공고', href: '#view' },
    { text: '클라우드 전환 컨설팅 용역 공고', href: '#view' },
  ]
  const rows = noticesFromLinks(links)
  assert.equal(rows.length, 3)
  // 앵커는 주소가 아니다 — 있는 척하면 눌러도 안 열린다
  assert.equal(rows[0].url, null)
})

test('같은 제목만 반복되면 목록이 아니다 — 같은 단추가 여러 번 나온 것이다', () => {
  assert.deepEqual(noticesFromLinks([
    { text: '자세히 보기입니다', href: '#view' },
    { text: '자세히 보기입니다', href: '#view' },
    { text: '자세히 보기입니다', href: '#view' },
  ]), [])
})

test('상세 주소가 있으면 자바스크립트 무리보다 그것을 쓴다', () => {
  const rows = noticesFromLinks([
    { text: '차세대 통합정보시스템 구축 사업', href: 'https://x.go.kr/bbs/View.do?bbsIdx=1' },
    { text: '데이터 플랫폼 유지관리 용역 재공고', href: 'https://x.go.kr/bbs/View.do?bbsIdx=2' },
    { text: '클라우드 전환 컨설팅 용역 공고', href: 'https://x.go.kr/bbs/View.do?bbsIdx=3' },
    { text: '스크립트로 여는 어떤 줄입니다', href: '#view' },
    { text: '스크립트로 여는 다른 줄입니다', href: '#view' },
    { text: '스크립트로 여는 또 다른 줄', href: '#view' },
    { text: '스크립트로 여는 넷째 줄입니다', href: '#view' },
  ])
  assert.equal(rows.length, 3)
  assert.ok(rows.every((r) => r.url?.includes('View.do')))
})

test('목록 줄에서 제목만 남긴다 — 실측 NIA 는 한 줄에 조회수·담당자까지 넣는다', () => {
  const row = '[조달입찰공고] AI기반 실종자 예측 시스템 구축 위탁감리 첨부파일 있음 new 2026.09.08 조회수 253 이용진 재무관리팀'
  assert.equal(cleanTitle(row), '[조달입찰공고] AI기반 실종자 예측 시스템 구축 위탁감리')
})

test('공고일은 버리지 않고 뽑는다 — 정렬에 쓴다', () => {
  assert.equal(dateFromRow('… new 2026.09.08 조회수 253'), '2026-09-08')
  assert.equal(dateFromRow('날짜가 없는 줄'), null)
})

test('제목만 있는 줄은 그대로 둔다 — 멀쩡한 제목을 깎으면 안 된다', () => {
  assert.equal(cleanTitle('차세대 통합정보시스템 구축 사업'), '차세대 통합정보시스템 구축 사업')
})

test('목록으로 가는 주소는 공고 줄이 아니다', () => {
  assert.equal(looksDetail('https://x.go.kr/bbs/List.do?cbIdx=1'), false)
  assert.equal(looksDetail('https://x.go.kr/bbs/View.do?bbsIdx=1'), true)
  assert.equal(looksDetail('https://x.go.kr/notice/read?seq=3'), true)
})

test('경로 끝 번호도 변하는 자리로 본다', () => {
  assert.equal(urlShape('https://x.go.kr/notice/101').key, urlShape('https://x.go.kr/notice/202').key)
  assert.equal(urlShape('https://x.go.kr/notice/101').hasVariable, true)
})

test('주소도 없으면 제목이 열쇠다 — 없으면 훑을 때마다 같은 공고가 다시 담긴다', () => {
  const n = {
    title: 'AI기반 실종자 예측 시스템 구축 위탁감리', noticeNo: null, agency: null,
    budgetAmount: null, noticeDate: null, url: null,
  }
  assert.equal(sourceKey(n, 'NIA'), sourceKey(n, 'NIA'))
  // 다른 기관의 같은 제목과는 안 섞인다
  assert.notEqual(sourceKey(n, 'NIA'), sourceKey(n, '다른 기관'))
  assert.equal(toSourceRows([n], 'org', 'NIA')[0].notice_no, sourceKey(n, 'NIA'))
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
