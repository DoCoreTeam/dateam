import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseNoticeUrl, noticeNoOf, roundOf, decodeDeep, isPrivateHost,
  titleFromPage, cleanTitleText,
} from './notice-url.ts'

// 실측 모양: 나라장터 상세는 프레임 주소 안에 진짜 주소가 인코딩되어 들어 있다
const FRAMED =
  'https://www.g2b.go.kr/pt/menu/selectSubFrame.do?framesrc=%2Fpt%2Fmenu%2FframeTgong.do%3Furl%3D' +
  'https%253A%252F%252Fwww.g2b.go.kr%253A8101%252Fep%252Finvitation%252Fpublish%252FbidInfoDtl.do' +
  '%253Fbidno%253D20250912345%2526bidseq%253D00'

const PLAIN_G2B =
  'https://www.g2b.go.kr:8101/ep/invitation/publish/bidInfoDtl.do?bidno=20250912345&bidseq=01'

test('★ 프레임 주소 안에 숨은 공고번호를 꺼낸다 — 겉으로는 framesrc 하나뿐이다', () => {
  // searchParams 로 보면 framesrc 밖에 없어서 공고번호가 안 잡힌다
  assert.equal(new URL(FRAMED).searchParams.get('bidno'), null)

  const got = parseNoticeUrl(FRAMED)
  assert.equal(got.ok, true)
  assert.equal(got.ok && got.kind, 'g2b')
  assert.equal(got.ok && got.noticeNo, '20250912345')
})

test('★ 차수 0 은 「없음」이 아니다 — 00 차를 null 로 두면 다른 차수를 불러온다', () => {
  assert.equal(roundOf(FRAMED), 0)
  assert.equal(roundOf(PLAIN_G2B), 1)
  assert.equal(roundOf('https://www.g2b.go.kr/x.do?bidno=20250912345'), null)
})

test('개편 전후 이름을 둘 다 읽는다 — 옛 링크가 아직 돌아다닌다', () => {
  assert.equal(noticeNoOf('https://www.g2b.go.kr/a.do?bidNtceNo=20251100077'), '20251100077')
  assert.equal(noticeNoOf('https://www.g2b.go.kr/a.do?bidPbancNo=R25BK00123456'), 'R25BK00123456')
  assert.equal(noticeNoOf('https://www.g2b.go.kr/a.do?bidno=20250912345'), '20250912345')
})

test('★ 나라장터인데 공고번호가 없으면 사유를 준다 — 목록 주소를 붙여넣는 일이 잦다', () => {
  const got = parseNoticeUrl('https://www.g2b.go.kr/pt/menu/selectSubFrame.do?framesrc=/list.do')
  assert.equal(got.ok, false)
  assert.equal(got.ok === false && got.reason, 'no_notice_no')
})

test('기관 자체 게시판은 쪽을 읽는 갈래로 간다', () => {
  const got = parseNoticeUrl('https://www.nia.or.kr/site/nia_kor/ex/bbs/View.do?cbIdx=78336&bcIdx=29963')
  assert.equal(got.ok && got.kind, 'page')
  assert.equal(got.ok && got.noticeNo, null)
})

test('★ 사설 주소는 받기 전에 막는다 — 서버가 내부망을 대신 두드려 주면 안 된다', () => {
  for (const host of ['localhost', '127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.0.1', '169.254.169.254']) {
    const got = parseNoticeUrl(`http://${host}/notice`)
    assert.equal(got.ok, false, host)
    assert.equal(got.ok === false && got.reason, 'private_host', host)
  }
  assert.equal(isPrivateHost('::1'), true)
  assert.equal(isPrivateHost('metadata.google.internal'), true)
  // 공인 주소는 막지 않는다 — 172.32 는 사설이 아니다
  assert.equal(isPrivateHost('172.32.0.1'), false)
  assert.equal(isPrivateHost('www.g2b.go.kr'), false)
})

test('http/https 가 아니면 거절한다', () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.go.kr/a']) {
    const got = parseNoticeUrl(url)
    assert.equal(got.ok === false && got.reason, 'not_http', url)
  }
})

test('빈 값과 주소가 아닌 글자를 구분한다 — 안내 문구가 달라야 한다', () => {
  assert.equal(parseNoticeUrl('').ok === false && parseNoticeUrl('').reason, 'empty')
  assert.equal(parseNoticeUrl('   ').ok === false && parseNoticeUrl('  ').reason, 'empty')
  const bad = parseNoticeUrl('공고 좀 봐 주세요')
  assert.equal(bad.ok === false && bad.reason, 'not_a_url')
})

test('깨진 인코딩이어도 죽지 않는다', () => {
  assert.equal(decodeDeep('%E0%A4%A'), '%E0%A4%A')
  assert.equal(parseNoticeUrl('https://www.g2b.go.kr/a.do?x=%E0%A4%A').ok, false)
})

test('★ og:title 이 먼저다 — title 에는 기관 이름이 붙는다', () => {
  const html = `<html><head>
    <meta property="og:title" content="콜롬비아 AI 기반 디지털정부 인프라 개선 전략 수립">
    <title>입찰공고 상세 | 한국지능정보사회진흥원</title>
  </head><body><h1>알림마당</h1></body></html>`
  assert.equal(titleFromPage(html), '콜롬비아 AI 기반 디지털정부 인프라 개선 전략 수립')
})

test('★ 꼬리를 자를 때 가장 긴 토막을 고른다 — 앞을 고르면 「홈」이 사업명이 된다', () => {
  assert.equal(
    cleanTitleText('홈 &gt; 입찰공고 &gt; 공공부문 인공지능 신뢰기반 제도 교육'),
    '공공부문 인공지능 신뢰기반 제도 교육',
  )
  assert.equal(
    cleanTitleText('차세대 지방행정 정보시스템 구축 | 행정안전부'),
    '차세대 지방행정 정보시스템 구축',
  )
})

test('하이픈으로는 안 자른다 — 사업명 안에 흔하다', () => {
  assert.equal(cleanTitleText('AI-센터 고도화 사업'), 'AI-센터 고도화 사업')
})

test('title 이 없으면 h1 로 간다 — 「이름을 못 읽음」보다 낫다', () => {
  assert.equal(titleFromPage('<body><h1>스마트 물류 실증 용역</h1></body>'), '스마트 물류 실증 용역')
  assert.equal(titleFromPage('<body><p>본문만 있다</p></body>'), null)
})
