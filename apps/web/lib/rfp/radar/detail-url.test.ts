import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detailCandidates, buildUrls, verifyDetailUrl, matchesTitle,
  MAX_CANDIDATES, ATTACHMENT_HREF,
} from './detail-url.ts'

const LIST = 'https://www.nia.or.kr/site/nia_kor/ex/bbs/List.do?cbIdx=78336'

// 실측(NIA): 줄마다 href="#view" 이고 이동은 onclick 이 한다
const HTML = `
<ul>
  <li><a href="#view" onclick="doBbsFView('78336','29963','16010100','29963');return false;">
    [조달입찰공고] 콜롬비아 AI 기반 디지털정부 인프라 개선 전략 수립</a></li>
  <li><a href="#view" onclick="doBbsFView('78336','29975','16010100','29975');return false;">
    [사전규격공개] 공공부문 인공지능 신뢰기반 제도 교육</a></li>
  <li><a href="#" onclick="doBbsFPag(2)">2</a></li>
</ul>`

test('★ onclick 에서 상세 후보를 만든다 — 목록에는 상세 주소가 없다', () => {
  const rows = detailCandidates(HTML, LIST)
  assert.equal(rows.length, 2)
  assert.ok(rows[0].text.includes('콜롬비아'))
  assert.ok(rows[0].urls.length > 0)
})

test('목록 이동 함수는 상세가 아니다 — doBbsFPag 를 공고로 보면 안 된다', () => {
  assert.equal(detailCandidates(HTML, LIST).some((r) => r.text === '2'), false)
})

test('★ 목록 주소에 이미 있는 값은 글 번호가 아니다', () => {
  // 78336 은 목록 주소의 cbIdx(게시판 번호)다. 이걸 글 번호로 넣으면 늘 같은 쪽을 연다
  const urls = detailCandidates(HTML, LIST)[0].urls.join(' ')
  assert.ok(urls.includes('29963'), '글 번호가 들어간다')
  assert.equal(/bcIdx=78336|nttId=78336/.test(urls), false, '게시판 번호가 글 번호 자리에 안 들어간다')
})

test('목록 파일 이름을 상세 파일 이름으로 바꾼다', () => {
  const urls = buildUrls(LIST, ['29963'])
  assert.ok(urls.some((u) => u.includes('View.do')))
  assert.equal(urls.some((u) => u.includes('List.do')), false)
})

test('후보 수에 상한이 있다 — 한 줄에 수십 번 요청하면 사이트가 막는다', () => {
  assert.ok(buildUrls(LIST, ['1', '2', '3']).length <= MAX_CANDIDATES)
})

test('주소가 아니면 후보가 없다', () => {
  assert.deepEqual(buildUrls('그냥 글자', ['1']), [])
})

test('★ 열렸다고 상세가 아니다 — 첨부가 있어야 인정한다', async () => {
  // 목록 주소에 모르는 질의를 붙여도 대개 200 이 오고 같은 목록이 다시 나온다
  const listAgain = async () => ({ ok: true, status: 200, text: async () => '<html>목록입니다</html>' } as Response)
  assert.equal(await verifyDetailUrl(['https://x/a', 'https://x/b'], listAgain), null)

  const withFile = async (u: string) => ({
    ok: true, status: 200,
    text: async () => (u.includes('b') ? '<a href="/common/board/Download.do?fileNo=1">첨부</a>' : '목록'),
  } as Response)
  const hit = await verifyDetailUrl(['https://x/a', 'https://x/b'], withFile)
  assert.equal(hit?.url, 'https://x/b')
})

test('한 후보가 죽어도 다음을 본다', async () => {
  let n = 0
  const flaky = async () => {
    n += 1
    if (n === 1) throw new Error('연결 끊김')
    return { ok: true, status: 200, text: async () => '<a href="FileDown.do?id=1">첨부</a>' } as Response
  }
  assert.ok(await verifyDetailUrl(['https://x/a', 'https://x/b'], flaky))
})

test('첨부 링크 모양을 여러 가지로 알아본다', () => {
  for (const h of ['Download.do?x=1', 'FileDown.do', 'atchFileId=ABC', 'getFile?id=1']) {
    assert.ok(ATTACHMENT_HREF.test(h), h)
  }
})

test('목록 줄과 공고 제목을 맞춘다', () => {
  assert.ok(matchesTitle(
    '[조달입찰공고] 콜롬비아 AI 기반 디지털정부 인프라 개선 전략 수립',
    '[조달입찰공고] 콜롬비아 AI 기반 디지털정부 인프라 개선 전략 수립',
  ))
  assert.equal(matchesTitle('전혀 다른 공고', '콜롬비아 AI 기반 디지털정부'), false)
})
