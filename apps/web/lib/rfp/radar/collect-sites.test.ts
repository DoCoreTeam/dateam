import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectFromSite, type SiteRow } from './collect-sites.ts'

const SITE: SiteRow = {
  id: 's1', name: '어느 기관', kind: 'web',
  url: 'https://x.go.kr/board', base_url: 'https://x.go.kr', enabled: true,
}

// 목록은 **같은 모양의 주소가 여럿**이다 — 규칙 폴백이 그 무리를 찾는다
const HTML = `<ul>
<li><a href="/view?id=1">차세대 통합정보시스템 구축 사업 입찰공고</a></li>
<li><a href="/view?id=2">데이터 플랫폼 유지관리 용역 재공고</a></li>
<li><a href="/view?id=3">클라우드 전환 컨설팅 용역 입찰공고</a></li>
</ul>`

function fakeDb(seen: string[] = []) {
  const inserted: unknown[] = []
  const updated: Record<string, unknown>[] = []
  const db: any = {
    from(table: string) {
      const q: any = { select: () => q, eq: () => q }
      q.in = async () => ({ data: seen.map((n) => ({ notice_no: n })), error: null })
      q.insert = async (rows: unknown[]) => { inserted.push(...rows); return { data: null, error: null } }
      q.update = (patch: Record<string, unknown>) => {
        if (table === 'rfp_source_sites') updated.push(patch)
        return { eq: async () => ({ data: null, error: null }) }
      }
      return q
    },
  }
  return { db, inserted, updated }
}

const page = async () => ({ ok: true, status: 200, text: async () => HTML } as Response)

test('사이트에서 공고를 모아 담는다 — 나라장터만 보면 늘 며칠 늦다', async () => {
  const f = fakeDb()
  const r = await collectFromSite(f.db, { orgId: 'o1', site: SITE, fetchImpl: page, now: () => 0 })
  assert.equal(r.found, 3)
  assert.equal(r.inserted, 3)
  assert.equal(f.inserted.length, 3)
})

test('AI 가 없으면 규칙만으로 뽑고 그 사실을 말한다', async () => {
  const f = fakeDb()
  const r = await collectFromSite(f.db, { orgId: 'o1', site: SITE, fetchImpl: page, now: () => 0 })
  assert.equal(r.rulesOnly, true)
})

test('AI 가 풀면 규칙으로 안 떨어진다', async () => {
  const f = fakeDb()
  const r = await collectFromSite(f.db, {
    orgId: 'o1', site: SITE, fetchImpl: page, now: () => 0,
    ask: async () => JSON.stringify({
      notices: [{ title: '차세대 통합정보시스템 구축 사업 입찰공고', url: 'https://x.go.kr/view?id=1', budgetAmount: 1200000000 }],
    }),
  })
  assert.equal(r.rulesOnly, false)
  assert.equal(r.inserted, 1)
  assert.equal((f.inserted[0] as { budget_amount: number }).budget_amount, 1200000000)
})

test('AI 가 죽어도 규칙으로 이어 간다 — 「아무것도 안 됨」이 되면 안 된다', async () => {
  const f = fakeDb()
  const r = await collectFromSite(f.db, {
    orgId: 'o1', site: SITE, fetchImpl: page, now: () => 0,
    ask: async () => { throw new Error('429') },
  })
  assert.equal(r.rulesOnly, true)
  assert.equal(r.inserted, 3)
})

test('메뉴만 있는 쪽에서는 아무것도 안 담는다 — 실측에서 이게 50건을 쓰레기로 채웠다', async () => {
  const f = fakeDb()
  const navOnly = async () => ({
    ok: true, status: 200,
    text: async () => `<ul>
      <li><a href="/site/main.do">한국지능정보사회진흥원 소개</a></li>
      <li><a href="/#gnb_menu">전체메뉴 바로가기</a></li>
      <li><a href="/ex/bbs/ListBusiness.do?businessMnCd=23001000">인공지능융합본부</a></li>
    </ul>`,
  } as Response)
  const r = await collectFromSite(f.db, { orgId: 'o1', site: SITE, fetchImpl: navOnly, now: () => 0 })
  assert.equal(r.inserted, 0)
  assert.equal(r.reason, 'no_notices')
  assert.equal(f.inserted.length, 0)
})

test('이미 담은 공고는 다시 안 넣는다', async () => {
  const f = fakeDb(['https://x.go.kr/view?id=1'])
  const r = await collectFromSite(f.db, { orgId: 'o1', site: SITE, fetchImpl: page, now: () => 0 })
  assert.equal(r.inserted, 2)
  assert.equal(r.skipped, 1)
})

test('사이트가 죽어도 던지지 않는다 — 한 곳 때문에 훑기가 멈추면 안 된다', async () => {
  const f = fakeDb()
  const r = await collectFromSite(f.db, {
    orgId: 'o1', site: SITE, now: () => 0,
    fetchImpl: async () => ({ ok: false, status: 503 } as Response),
  })
  assert.equal(r.reason, 'http_503')
  assert.equal(r.inserted, 0)
})

test('결과를 사이트 줄에 남긴다 — 「이 사이트는 왜 0건인지」를 화면이 말해야 한다', async () => {
  const f = fakeDb()
  await collectFromSite(f.db, {
    orgId: 'o1', site: SITE, now: () => 0,
    fetchImpl: async () => ({ ok: false, status: 404 } as Response),
  })
  assert.equal(f.updated.length, 1)
  assert.equal((f.updated[0].last_result as { reason: string }).reason, 'http_404')
})

test('주소가 없으면 뒤질 데가 없다', async () => {
  const f = fakeDb()
  const r = await collectFromSite(f.db, { orgId: 'o1', site: { ...SITE, url: null }, now: () => 0 })
  assert.equal(r.reason, 'no_url')
})
