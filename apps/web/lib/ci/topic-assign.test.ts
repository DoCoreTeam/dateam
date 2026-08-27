// lib/ci/topic-assign.test.ts — 「주 주제로 올리는 주제는 부 주제에서 빠진다」를 잠근다
//
// 왜 이 가드가 필요한가: 이 규칙을 어기면 tsc·lint 는 전부 초록인데
// **버튼만 100% 죽는다**(23514 는 실행 시점에만 난다).
// 실제로 검토 화면의 「다른 주제로 확정」이 그 상태로 배포돼 있었다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dropSecondaryOverlap, userTopicPatch } from './topic-assign.ts'

const ENT = '02aca045-a441-49f9-9690-e73956e941ba'
const FOOD = 'b2a3b1a0-5b06-4ad3-90cb-3a1344867baa'
const MUSIC = 'ee43dffe-0858-45c1-a369-d22cbc7b061e'

/** PostgREST 대역 — 부른 순서와 필터·본문을 그대로 기록한다 */
function fakeDb(pages: { secondary_topic_ids: string[]; id?: string }[][]) {
  const calls: { op: string; body?: unknown; filters: [string, unknown][] }[] = []
  let read = 0
  function builder(op: string, body?: unknown) {
    const filters: [string, unknown][] = []
    const rec = { op, body, filters }
    const self: Record<string, unknown> = {}
    for (const f of ['eq', 'is', 'in', 'contains', 'limit']) {
      self[f] = (...args: unknown[]) => { filters.push([f, args]); return self }
    }
    self.select = () => self
    self.then = (resolve: (v: unknown) => unknown) => {
      calls.push(rec)
      if (op === 'select') return resolve({ data: pages[read++] ?? [], error: null })
      return resolve({ data: null, error: null })
    }
    return self
  }
  return {
    calls,
    from: () => ({
      select: (...a: unknown[]) => builder('select', a),
      update: (body: unknown) => builder('update', body),
    }),
  }
}

test('주제를 지우는 경우엔 부 주제를 건드리지 않는다', async () => {
  const db = fakeDb([])
  assert.equal(await dropSecondaryOverlap(db, null, { kind: 'ids', ids: ['x'] }), null)
  assert.equal(db.calls.length, 0)
})

test('겹치는 것이 없으면 아무것도 쓰지 않는다', async () => {
  const db = fakeDb([[]])
  const err = await dropSecondaryOverlap(db, ENT, {
    kind: 'group', match: { workspaceId: 'w', fromTopicId: FOOD, channelId: 'c' },
  })
  assert.equal(err, null)
  assert.deepEqual(db.calls.map((c) => c.op), ['select'])
})

test('묶음: 겹친 주제만 빼고 나머지 부 주제는 남긴다', async () => {
  // 1회차에 {ENT,MUSIC} 을 발견 → {MUSIC} 으로 갱신, 2회차엔 남은 것이 없다
  const db = fakeDb([[{ secondary_topic_ids: [ENT, MUSIC] }], []])
  const err = await dropSecondaryOverlap(db, ENT, {
    kind: 'group', match: { workspaceId: 'w', fromTopicId: FOOD, channelId: 'c' },
  })
  assert.equal(err, null)
  const up = db.calls.find((c) => c.op === 'update')!
  assert.deepEqual(up.body, { secondary_topic_ids: [MUSIC] }, 'ENT 만 빠지고 MUSIC 은 남는다')
  // id 목록이 아니라 **조건**으로 지운다 — URL 길이·건수 상한이 다시 생기면 안 된다
  assert.ok(!up.filters.some(([f]) => f === 'in'), '묶음 정리는 id 목록을 쓰지 않는다')
  assert.ok(
    up.filters.some(([f, a]) => f === 'eq' && (a as unknown[])[0] === 'secondary_topic_ids'
      && (a as unknown[])[1] === `{${ENT},${MUSIC}}`),
    '같은 조합을 한 번에 지우려면 배열 값으로 걸러야 한다',
  )
})

test('묶음: 조합이 여러 가지면 가짓수만큼만 돈다', async () => {
  const db = fakeDb([
    [{ secondary_topic_ids: [ENT] }],
    [{ secondary_topic_ids: [ENT, MUSIC] }],
    [],
  ])
  assert.equal(await dropSecondaryOverlap(db, ENT, {
    kind: 'group', match: { workspaceId: 'w', fromTopicId: FOOD, channelId: null },
  }), null)
  assert.equal(db.calls.filter((c) => c.op === 'update').length, 2)
})

test('묶음: 조합이 끝나지 않으면 조용히 넘어가지 않고 오류를 돌려준다', async () => {
  // 갱신이 실제로 안 먹는 상황 — 같은 행이 계속 잡힌다
  const db = fakeDb(Array.from({ length: 200 }, () => [{ secondary_topic_ids: [ENT] }]))
  const err = await dropSecondaryOverlap(db, ENT, {
    kind: 'group', match: { workspaceId: 'w', fromTopicId: FOOD, channelId: 'c' },
  })
  assert.ok(err instanceof Error, '멈추지 않으면 다음 갱신이 23514 로 죽는다')
})

test('고른 것만: 결과 배열이 같은 행끼리 한 번에 쓴다', async () => {
  const db = fakeDb([[
    { id: 'a', secondary_topic_ids: [ENT] },
    { id: 'b', secondary_topic_ids: [ENT] },
    { id: 'c', secondary_topic_ids: [ENT, MUSIC] },
  ]])
  assert.equal(await dropSecondaryOverlap(db, ENT, { kind: 'ids', ids: ['a', 'b', 'c'] }), null)
  const ups = db.calls.filter((c) => c.op === 'update')
  assert.equal(ups.length, 2, '{} 묶음 하나 + {MUSIC} 묶음 하나')
  assert.deepEqual(ups[0].body, { secondary_topic_ids: [] })
  assert.deepEqual(ups[1].body, { secondary_topic_ids: [MUSIC] })
})

test('오류는 삼키지 않고 그대로 돌려준다', async () => {
  const boom = { code: '42501', message: 'nope' }
  const db = {
    calls: [],
    from: () => ({
      select: () => {
        const self: Record<string, unknown> = {}
        for (const f of ['eq', 'is', 'in', 'contains', 'limit']) self[f] = () => self
        self.then = (r: (v: unknown) => unknown) => r({ data: null, error: boom })
        return self
      },
      update: () => ({}),
    }),
  }
  assert.equal(await dropSecondaryOverlap(db, ENT, { kind: 'ids', ids: ['a'] }), boom)
})

test('사람이 확정한 값 — 주제가 있으면 확신도 1, 지우면 0', () => {
  assert.deepEqual(userTopicPatch(ENT), {
    topic_id: ENT, topic_source: 'user', topic_confidence: 1, review_state: 'resolved',
  })
  assert.equal(userTopicPatch(null).topic_confidence, 0)
})
