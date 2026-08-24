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
  fetchProject,
  listDeployments,
  readNdjsonStream,
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

describe('readNdjsonStream — 스트림은 우리가 끊는다', () => {
  const row = (i: number, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ rowId: `r${i}`, level: 'error', message: `m${i}`, source: 'serverless', timestampInMs: 1_700_000_000_000 + i, domain: 'd', requestMethod: 'GET', requestPath: '/x', responseStatusCode: 500, messageTruncated: false, ...extra })

  it('줄 수 상한에 닿으면 자르고 capped 로 밝힌다', async () => {
    const body = streamOf([`${row(1)}\n${row(2)}\n${row(3)}\n`])
    const out = await readNdjsonStream(body, 2, 2000)
    assert.equal(out.logs.length, 2)
    assert.equal(out.capped, true)
  })

  it('끝나지 않는 스트림은 시간 상한에서 끊는다', async () => {
    const body = streamOf([`${row(1)}\n`], { keepOpen: true })
    const started = Date.now()
    const out = await readNdjsonStream(body, 100, 300)
    assert.equal(out.logs.length, 1)
    assert.equal(out.capped, true)
    assert.ok(Date.now() - started < 2000, '상한을 넘겨 매달리면 안 된다')
  })

  it('조용해지면 상한을 다 기다리지 않고 끊는다 — 그리고 그건 자른 게 아니다', async () => {
    // Vercel 런타임 로그는 최근 것을 뱉고 **계속 열려 있는다**. 상한만 두면 매번 그만큼 멈춘다.
    const body = streamOf([`${row(1)}\n${row(2)}\n`], { keepOpen: true })
    const started = Date.now()
    const out = await readNdjsonStream(body, 100, 5000, 200)
    const elapsed = Date.now() - started
    assert.equal(out.logs.length, 2)
    assert.equal(out.capped, false, '더 없는 것과 우리가 자른 것은 다른 사실이다')
    assert.ok(elapsed < 2000, `조용한 스트림을 상한까지 붙들면 안 된다 (${elapsed}ms)`)
  })

  it('개행 없이 끝난 마지막 줄도 잃지 않는다', async () => {
    const body = streamOf([`${row(1)}\n`, row(2)])
    const out = await readNdjsonStream(body, 100, 2000)
    assert.deepEqual(out.logs.map((l) => l.rowId), ['r1', 'r2'])
  })

  it('깨진 줄 하나가 나머지를 죽이지 않는다', async () => {
    const body = streamOf([`${row(1)}\n{ not json\n${row(2)}\n`])
    const out = await readNdjsonStream(body, 100, 2000)
    assert.deepEqual(out.logs.map((l) => l.rowId), ['r1', 'r2'])
  })

  it('구분자(delimiter) 줄은 로그가 아니다', async () => {
    const body = streamOf([`${row(1, { source: 'delimiter' })}\n${row(2)}\n`])
    const out = await readNdjsonStream(body, 100, 2000)
    assert.deepEqual(out.logs.map((l) => l.rowId), ['r2'])
  })

  it('청크가 줄 중간에서 잘려도 이어 붙인다', async () => {
    const line = row(7)
    const body = streamOf([line.slice(0, 20), `${line.slice(20)}\n`])
    const out = await readNdjsonStream(body, 100, 2000)
    assert.deepEqual(out.logs.map((l) => l.rowId), ['r7'])
  })
})
