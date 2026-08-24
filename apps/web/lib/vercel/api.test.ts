// lib/vercel/api.ts 가드 — 이 파일이 막는 것은 **실제로 한 번 일어난 일**이다
//
// ① 커서를 잘못 써서 같은 페이지를 반복 조회한 사고(v0.7.572, "같은 50건 반복" 오탐).
//    서버가 커서를 무시하는 상황을 그대로 재현해, 우리가 **끊는지** 본다.
// ② 런타임 로그 스트림은 스스로 끝나지 않는다 — 줄 수·시간 상한에 닿으면 끊고 `capped` 로 밝히는지.
// ③ 실패가 사람이 읽을 수 있는 말을 갖는지(조용히 빈 목록으로 만들지 않는지).

import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  VercelApiError,
  type VercelFailReason,
  fetchDeployEvents,
  fetchProject,
  listDeployments,
} from './api.ts'
import type { VercelConfig } from './config.ts'

const CONFIG: VercelConfig = { token: 'tok_test', projectId: 'prj_test', teamId: null }
const realFetch = globalThis.fetch
const calls: string[] = []

function stub(handler: (url: string) => { status: number; body?: unknown }): void {
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url))
    const r = handler(String(url))
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {},
      text: async () => JSON.stringify(r.body ?? {}),
    }
  }) as unknown as typeof fetch
}

function deployment(uid: string, created: number) {
  return { uid, name: 'web', url: `${uid}.vercel.app`, readyState: 'READY', state: 'READY', created, target: 'production', inspectorUrl: null }
}

/** 문자열을 NDJSON 스트림으로. 네트워크 없이 파서 규칙만 검증한다 */
function streamOf(chunks: string[], opts: { keepOpen?: boolean } = {}): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  let i = 0
  return new ReadableStream({
    async pull(controller) {
      if (i < chunks.length) { controller.enqueue(enc.encode(chunks[i++])); return }
      // 끝내지 않는 스트림 — Vercel 런타임 로그가 실제로 이렇게 동작한다
      if (opts.keepOpen) { await new Promise((r) => setTimeout(r, 50)); return }
      controller.close()
    },
  })
}

afterEach(() => { globalThis.fetch = realFetch; calls.length = 0 })

describe('listDeployments — 커서', () => {
  it('pagination.next 를 다음 요청의 until 로 넘긴다', async () => {
    let page = 0
    stub(() => {
      page += 1
      return page === 1
        ? { status: 200, body: { deployments: [deployment('a', 300), deployment('b', 200)], pagination: { count: 2, next: 200, prev: null } } }
        : { status: 200, body: { deployments: [deployment('c', 100)], pagination: { count: 1, next: null, prev: null } } }
    })

    const out = await listDeployments(CONFIG, { limit: 3 })

    assert.deepEqual(out.deployments.map((d) => d.uid), ['a', 'b', 'c'])
    assert.equal(out.stalled, false)
    assert.ok(calls[1].includes('until=200'), `두 번째 호출에 커서가 실려야 한다: ${calls[1]}`)
  })

  it('서버가 커서를 무시하고 같은 페이지를 돌려주면 끊고 stalled 로 밝힌다', async () => {
    // v0.7.572 실측 재현 — 이 가드가 없으면 같은 항목이 limit 까지 채워지거나 무한히 돈다
    stub(() => ({
      status: 200,
      body: { deployments: [deployment('a', 300), deployment('b', 200)], pagination: { count: 2, next: 200, prev: null } },
    }))

    const out = await listDeployments(CONFIG, { limit: 50 })

    assert.deepEqual(out.deployments.map((d) => d.uid), ['a', 'b'], '같은 배포가 중복으로 쌓이면 안 된다')
    assert.equal(out.stalled, true, '조용히 멈추면 관리자는 "이게 전부"로 읽는다')
    assert.ok(calls.length <= 3, `제자리를 도는 것을 곧바로 끊어야 한다 (호출 ${calls.length}회)`)
  })

  it('커서가 제자리면(next === until) 더 부르지 않는다', async () => {
    let page = 0
    stub(() => {
      page += 1
      return page === 1
        ? { status: 200, body: { deployments: [deployment('a', 300)], pagination: { count: 1, next: 200, prev: null } } }
        : { status: 200, body: { deployments: [deployment('b', 200)], pagination: { count: 1, next: 200, prev: null } } }
    })

    const out = await listDeployments(CONFIG, { limit: 50 })

    assert.deepEqual(out.deployments.map((d) => d.uid), ['a', 'b'])
    assert.equal(calls.length, 2)
  })
})

describe('실패는 사람 말로', () => {
  const cases: [number, VercelFailReason, RegExp][] = [
    [401, 'auth', /토큰/],
    [403, 'auth', /팀 ID/],
    [404, 'not-found', /프로젝트/],
    [429, 'rate-limit', /한도/],
    [500, 'server', /응답 오류/],
  ]
  for (const [status, reason, re] of cases) {
    it(`${status} → ${reason}`, async () => {
      stub(() => ({ status }))
      await assert.rejects(
        () => fetchProject(CONFIG),
        (e: VercelApiError) => {
          assert.equal(e.reason, reason)
          assert.match(e.message, re)
          assert.doesNotMatch(e.message, /tok_test/, '오류 문구에 토큰이 실리면 안 된다')
          return true
        },
      )
    })
  }
})

describe('fetchDeployEvents — 되는 endpoint 를 쓴다', () => {
  // 왜 이 endpoint 인가: 문서가 말하는 runtime-logs 는 이 계정에서 **응답 헤더조차 오지 않았다**
  // (실측 2026-08-24: 파라미터 4조합 · Accept 헤더 · 실트래픽 30초 → 전부 AbortError).
  // v3 events 는 498ms 에 649건을 준다.

  const ev = (over: Record<string, unknown> = {}) => ({
    id: 'e1', type: 'stdout', text: 'hello', date: 1_700_000_000_000, ...over,
  })

  it('follow=0 을 반드시 붙인다 — 빼면 이 endpoint 도 스트림으로 열려 끝나지 않는다', async () => {
    stub(() => ({ status: 200, body: [ev()] }))
    await fetchDeployEvents(CONFIG, 'dpl_1')
    assert.ok(calls[0].includes('follow=0'), calls[0])
    assert.ok(calls[0].includes('direction=backward'), '최신부터 받아야 한다')
    assert.ok(calls[0].includes('/v3/deployments/dpl_1/events'), calls[0])
  })

  it('payload 로 감싼 모양(v2)도 같은 결과로 편다', async () => {
    stub(() => ({ status: 200, body: [{ type: 'stderr', created: 5, payload: { id: 'p1', text: 'boom', date: 7, level: 'error' } }] }))
    const { events } = await fetchDeployEvents(CONFIG, 'dpl_1')
    assert.deepEqual(events, [{ id: 'p1', type: 'stderr', text: 'boom', date: 7, level: 'error', info: undefined }])
  })

  it('빈 줄과 시각 없는 줄은 버린다 — 화면에 빈 행을 만들지 않는다', async () => {
    stub(() => ({ status: 200, body: [ev(), ev({ id: 'e2', text: '   ' }), ev({ id: 'e3', date: undefined })] }))
    const { events } = await fetchDeployEvents(CONFIG, 'dpl_1')
    assert.deepEqual(events.map((e) => e.id), ['e1'])
  })

  it('배열이 아닌 응답에도 터지지 않는다', async () => {
    stub(() => ({ status: 200, body: { error: 'nope' } }))
    const { events } = await fetchDeployEvents(CONFIG, 'dpl_1')
    assert.deepEqual(events, [])
  })

  it('줄 수 상한에 닿으면 잘랐다고 밝힌다', async () => {
    stub(() => ({ status: 200, body: [ev({ id: 'a' }), ev({ id: 'b' }), ev({ id: 'c' })] }))
    const { events, capped } = await fetchDeployEvents(CONFIG, 'dpl_1', 2)
    assert.equal(events.length, 2)
    assert.equal(capped, true)
  })
})
