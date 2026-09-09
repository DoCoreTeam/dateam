import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectNotices, MAX_PAGES } from './collect.ts'
import { inquiryRange } from '../g2b/client.ts'

/** 나라장터 응답 흉내 — items 는 건수가 1이면 배열이 아니다 */
function reply(items: Record<string, unknown>[], totalCount = items.length) {
  return {
    ok: true, status: 200,
    json: async () => ({ response: { body: { items: { item: items }, totalCount } } }),
  } as unknown as Response
}

function notice(no: string) {
  return { bidNtceNo: no, bidNtceOrd: '00', bidNtceNm: `${no} 사업`, ntceInsttNm: '어느 기관' }
}

function fakeDb(seen: { notice_no: string; notice_round: number | null }[] = [], meta = 'KEY') {
  const inserted: unknown[] = []
  const db: any = {
    from(table: string) {
      const q: any 
        = { _t: table, select: () => q, eq: () => q, in: async () => ({ data: seen, error: null }) }
      q.insert = (rows: unknown[]) => { inserted.push(...rows); return Promise.resolve({ data: null, error: null }) }
      // META 읽기(readServiceKey)
      // 키는 META 한 행 안에 통째로 들어 있다(org_content.value 가 객체다)
      const metaRow = meta ? { value: { g2bServiceKey: meta } } : { value: {} }
      q.maybeSingle = async () => ({ data: metaRow, error: null })
      q.single = async () => ({ data: metaRow, error: null })
      return q
    },
    async rpc() { return { data: null, error: null } },
  }
  return { db, inserted }
}

test('조회 구간은 KST 벽시계다 — UTC 를 넣으면 9시간 어긋난 구간을 훑는다', () => {
  // 2026-09-09T00:00:00Z = KST 09:00
  const r = inquiryRange(Date.parse('2026-09-09T00:00:00Z'), 1)
  assert.equal(r.to, '202609090900')
  assert.equal(r.from, '202609080900')
})

test('서비스 키가 없으면 실패가 아니라 안내다 — 크론 로그를 빨갛게 채우지 않는다', async () => {
  const f = fakeDb([], '')
  const out = await collectNotices(f.db, { orgId: 'o1' })
  assert.equal(out.reason, 'no_service_key')
  assert.ok(out.guide && out.guide.length > 0)
})

test('가져온 공고를 표에 넣는다 — 이게 없어서 레이더가 늘 0건이었다', async () => {
  const f = fakeDb()
  const out = await collectNotices(f.db, {
    orgId: 'o1', maxPages: 1,
    fetchImpl: async () => reply([notice('2026-01'), notice('2026-02')]),
  })
  assert.equal(out.inserted, 2)
  assert.equal(f.inserted.length, 2)
})

test('이미 담은 공고는 다시 안 넣는다', async () => {
  const f = fakeDb([{ notice_no: '2026-01', notice_round: 0 }])
  const out = await collectNotices(f.db, {
    orgId: 'o1', maxPages: 1,
    fetchImpl: async () => reply([notice('2026-01'), notice('2026-02')]),
  })
  assert.equal(out.inserted, 1)
  assert.equal(out.skipped, 1)
})

test('첫 쪽부터 실패하면 사유와 안내를 돌려준다', async () => {
  const f = fakeDb()
  const out = await collectNotices(f.db, {
    orgId: 'o1',
    fetchImpl: async () => ({ ok: false, status: 500 } as unknown as Response),
  })
  assert.equal(out.reason, 'upstream_error')
  assert.ok(out.guide)
  assert.equal(f.inserted.length, 0)
})

test('뒷쪽이 실패해도 가져온 것까지는 담는다', async () => {
  const f = fakeDb()
  let page = 0
  const out = await collectNotices(f.db, {
    orgId: 'o1', maxPages: 3,
    fetchImpl: async () => {
      page += 1
      return page === 1 ? reply([notice('a')]) : ({ ok: false, status: 500 } as unknown as Response)
    },
  })
  assert.equal(out.inserted, 1)
})

test('한 쪽이 비면 더 안 넘긴다 — 빈 쪽을 열 번 부르지 않는다', async () => {
  const f = fakeDb()
  let calls = 0
  await collectNotices(f.db, {
    orgId: 'o1', maxPages: MAX_PAGES,
    fetchImpl: async () => { calls += 1; return reply([]) },
  })
  assert.equal(calls, 1)
})

test('쪽 수는 열 장을 못 넘는다 — 한 번의 훑기가 몇 분이 되면 안 된다', async () => {
  const f = fakeDb()
  let calls = 0
  await collectNotices(f.db, {
    orgId: 'o1', maxPages: 999,
    fetchImpl: async () => { calls += 1; return reply([notice(`n${calls}`)]) },
  })
  assert.equal(calls, 10)
})
