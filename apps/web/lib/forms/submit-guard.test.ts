// 제출 가드 — 「눌렀는데 영영 안 끝나는 버튼」을 구조적으로 못 만들게 한다.
// 실측 2026-08-31: 주간보고가 이 셋(시간제한·try/catch·finally)이 없어 2주를 멈춰 있었다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  withSubmitGuard, submitFailureMessage, SubmitTimeoutError, SUBMIT_TIMEOUT_MS,
} from './submit-guard.ts'

function spy() {
  const calls: string[] = []
  return {
    calls,
    onError: (m: string) => { calls.push('error:' + m) },
    onDone: () => { calls.push('done') },
  }
}

test('성공하면 true 를 주고 진행 표시를 되돌린다', async () => {
  const s = spy()
  const ok = await withSubmitGuard(async () => { /* 정상 */ }, s)
  assert.equal(ok, true)
  assert.deepEqual(s.calls, ['done'])
})

test('★ 본문이 던져도 진행 표시가 반드시 꺼진다 — 이게 2주를 멈춘 자리다', async () => {
  const s = spy()
  const ok = await withSubmitGuard(async () => { throw new TypeError("Cannot read properties of undefined (reading 'ok')") }, s)
  assert.equal(ok, false)
  assert.ok(s.calls.some((c) => c.startsWith('error:')), '사용자에게 읽을 말이 떠야 한다')
  assert.ok(s.calls.includes('done'), 'finally 로 진행 표시를 되돌려야 한다')
})

test('★ 서버가 영원히 답을 안 줘도 끝난다 — 시간 제한이 없으면 화면이 영원히 기다린다', async () => {
  const s = spy()
  const ok = await withSubmitGuard(
    (signal) => new Promise<void>((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }),
    s, 30,
  )
  assert.equal(ok, false)
  assert.ok(s.calls.includes('done'))
  assert.match(s.calls.find((c) => c.startsWith('error:'))!, /제시간에 끝나지 않았습니다/)
})

test('시간 초과 신호가 실제로 fetch 를 끊을 수 있게 전달된다', async () => {
  let seen: AbortSignal | null = null
  await withSubmitGuard(async (signal) => { seen = signal }, spy())
  assert.ok(seen, 'signal 을 본문에 넘겨야 요청까지 정리된다')
})

test('실패 문구는 사과하지 않고 다음 조치와 「글은 남아 있다」를 말한다', () => {
  for (const err of [new SubmitTimeoutError(), new Error('boom'), new DOMException('x', 'AbortError')]) {
    const m = submitFailureMessage(err)
    assert.ok(!/죄송|미안/.test(m), `사과하지 않는다: ${m}`)
    assert.match(m, /다시 시도|다시 시도해/, `다음 조치를 준다: ${m}`)
    assert.match(m, /그대로|남아 있습니다|남아 있으니/, `쓴 글이 남아 있음을 말한다: ${m}`)
  }
})

test('시간 제한은 사람이 기다릴 만하되 느린 회선을 실패로 만들지 않는다', () => {
  assert.ok(SUBMIT_TIMEOUT_MS >= 10_000 && SUBMIT_TIMEOUT_MS <= 30_000, `현재 ${SUBMIT_TIMEOUT_MS}ms`)
})
