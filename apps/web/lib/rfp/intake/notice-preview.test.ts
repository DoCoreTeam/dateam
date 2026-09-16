import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { previewNotice, isFail, type PreviewDeps } from './notice-preview.ts'

const WEB = join(import.meta.dirname, '..', '..', '..')
const ROUTE = 'app/api/rfp/intake/notice-url/route.ts'

const G2B_URL = 'https://www.g2b.go.kr:8101/ep/invitation/publish/bidInfoDtl.do?bidno=20250912345&bidseq=00'
const PAGE_URL = 'https://www.nia.or.kr/site/nia_kor/ex/bbs/View.do?cbIdx=78336&bcIdx=29963'

const PAGE_HTML = `<html><head><title>콜롬비아 AI 기반 디지털정부 인프라 개선 전략 수립 | 한국지능정보사회진흥원</title></head>
<body><a href="/Download.do?bcIdx=29963&fileNo=1">제안요청서.hwp</a></body></html>`

/** 아무것도 안 하는 바닥 — 시험마다 필요한 것만 덮어쓴다 */
function deps(over: Partial<PreviewDeps> = {}): PreviewDeps {
  return {
    serviceKey: async () => 'KEY',
    fetchNotice: async () => ({ ok: true, data: {} }),
    attachmentsOf: () => [],
    toSourceRow: () => ({
      title: null, noticeNo: null, noticeRound: null,
      announcingAgency: null, demandAgency: null, budgetAmount: null,
    }),
    fetchPage: async () => ({ ok: true, html: '', reason: null }),
    attachmentsFromPage: async () => [],
    noKeyGuide: '키가 없습니다',
    ...over,
  }
}

test('★ 나라장터 링크는 열린 API 로 간다 — 쪽을 받아도 첨부가 안 나온다', async () => {
  const called: string[] = []
  const got = await previewNotice(G2B_URL, deps({
    fetchNotice: async (input) => {
      called.push(`notice:${input.noticeNo}:${input.round}`)
      return { ok: true, data: { bidNtceNm: '차세대 시스템 구축' } }
    },
    toSourceRow: () => ({
      title: '차세대 시스템 구축', noticeNo: '20250912345', noticeRound: 0,
      announcingAgency: '조달청', demandAgency: null, budgetAmount: 1_200_000_000,
    }),
    attachmentsOf: () => [{ fileName: '제안요청서.hwp', url: 'https://x/a.hwp', slot: 1 }],
    fetchPage: async () => { called.push('page'); return { ok: true, html: '', reason: null } },
  }))

  assert.equal(isFail(got), false)
  assert.deepEqual(called, ['notice:20250912345:0'], '쪽은 안 받는다')
  assert.equal(!isFail(got) && got.kind, 'g2b')
  assert.equal(!isFail(got) && got.title, '차세대 시스템 구축')
  assert.equal(!isFail(got) && got.attachments.length, 1)
  assert.equal(!isFail(got) && got.reason, null)
})

test('★ 기관 게시판 링크는 쪽을 연다 — 그쪽은 열린 API 가 없다', async () => {
  const called: string[] = []
  const got = await previewNotice(PAGE_URL, deps({
    fetchNotice: async () => { called.push('notice'); return { ok: true, data: {} } },
    fetchPage: async (url) => { called.push(`page:${url}`); return { ok: true, html: PAGE_HTML, reason: null } },
    attachmentsFromPage: async () => [{ fileName: '제안요청서.hwp', url: 'https://nia/a.hwp', slot: 1 }],
  }))

  assert.deepEqual(called, [`page:${PAGE_URL}`], '나라장터는 안 부른다')
  assert.equal(!isFail(got) && got.kind, 'page')
  assert.equal(!isFail(got) && got.title, '콜롬비아 AI 기반 디지털정부 인프라 개선 전략 수립')
  assert.equal(!isFail(got) && got.attachments[0].name, '제안요청서.hwp')
})

test('★ 연동 키가 없으면 그렇게 말한다 — 「실패」로 두면 사용자는 기다리기만 한다', async () => {
  const got = await previewNotice(G2B_URL, deps({ serviceKey: async () => null }))
  assert.equal(isFail(got), true)
  assert.equal(isFail(got) && got.error, 'no_service_key')
  assert.equal(isFail(got) && got.status, 409)
  assert.equal(isFail(got) && got.fallback, '키가 없습니다')
  // 우리가 못 열어도 사람이 열 주소는 준다
  assert.equal(isFail(got) && got.url, G2B_URL)
})

test('공고를 못 찾으면 404 와 다음 손을 함께 준다', async () => {
  const got = await previewNotice(G2B_URL, deps({
    fetchNotice: async () => ({ ok: false, reason: 'not_found', detail: '', fallback: '번호를 확인해 주세요' }),
  }))
  assert.equal(isFail(got) && got.status, 404)
  assert.equal(isFail(got) && got.fallback, '번호를 확인해 주세요')
})

test('★ 쪽을 못 열면 사유가 남는다 — 「첨부 0건」으로 뭉뚱그리면 원인이 사라진다', async () => {
  const got = await previewNotice(PAGE_URL, deps({
    fetchPage: async () => ({ ok: false, html: '', reason: 'http_404' }),
  }))
  assert.equal(isFail(got) && got.error, 'http_404')
  assert.equal(isFail(got) && got.status, 502)
})

test('첨부가 없으면 갈래마다 다른 사유를 준다 — 할 일이 다르다', async () => {
  const page = await previewNotice(PAGE_URL, deps())
  assert.equal(!isFail(page) && page.reason, 'no_attachment_on_page')

  const g2b = await previewNotice(G2B_URL, deps())
  assert.equal(!isFail(g2b) && g2b.reason, 'no_attachment')
})

test('주소가 틀리면 400 이고 사유가 그대로 온다', async () => {
  const got = await previewNotice('공고 좀 봐 주세요', deps())
  assert.equal(isFail(got) && got.status, 400)
  assert.equal(isFail(got) && got.error, 'not_a_url')
})

test('★ 미리보기 창구는 아무것도 저장하지 않는다 — 빈 케이스를 남기면 안 된다', () => {
  const src = readFileSync(join(WEB, ROUTE), 'utf8')
  assert.equal(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(src), false, '쓰기 호출이 있다')
  // 아무나 우리 서버로 바깥 주소를 열게 하면 안 된다
  assert.match(src, /requireMemberApi\(\)/)
  assert.match(src, /if \(gate\.error\) return gate\.error/)
})
