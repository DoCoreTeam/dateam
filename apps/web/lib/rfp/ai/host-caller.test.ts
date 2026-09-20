// lib/rfp/ai/host-caller.test.ts — RFP 분석이 키 하나에 매이지 않는가
//
// 여기는 **사람이 화면 앞에 없는** 자리다. 분석은 잡에서 돌고, 키가 마르면 그 판이
// 통째로 실패한 뒤 한참 있다가 「분석이 안 됐다」만 남는다. 그래서 조용하다.
//
// 그리고 이 길에는 지켜야 할 순서가 있다 — **등급 관문이 먼저다.** 키 교체가
// 그 앞으로 새면, 관문이 막은 모델로 문서가 나간다. 그 둘을 함께 센다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { makeHostCaller, estimateTokens } from './host-caller.ts'
import type { AiModel } from './models.ts'
import type { CallRequest } from './gateway.ts'
import type { KeyPoolEntry } from '../../ai/key-pool.ts'

function keyEntry(label: string, apiKey: string): KeyPoolEntry {
  return {
    id: label, provider: 'gemini', label, apiKey,
    priority: 0, isPaid: false, isActive: true, cooldownUntil: null,
    disabledReason: null, consecutiveFailures: 0,
  }
}

const MODEL = {
  id: 'gemini-pro', vendorId: 'gemini', modelName: 'gemini-3.7-flash',
} as unknown as AiModel

const REQ = { prompt: '가려진 글', orgId: 'o', caseId: 'c', purpose: 'analyze' } as unknown as CallRequest

/** 무엇을 받았는지 그대로 적어 두는 가짜 공급자 */
function fakeProvider(onCall: (args: { apiKey: string; model: string; content: string }) => void, fail: (apiKey: string) => Error | null) {
  return () => ({
    label: '가짜',
    capabilities: { vision: false, tools: false },
    async streamChat(args: { apiKey: string; model: string; turns: { content: string }[] }) {
      onCall({ apiKey: args.apiKey, model: args.model, content: args.turns[0].content })
      const e = fail(args.apiKey)
      if (e) throw e
      return { text: '답', usage: { promptTokens: 10, outputTokens: 20 }, stopped: false }
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
}

test('★ 첫 키가 한도면 다음 키로 같은 일을 다시 한다', async () => {
  const seen: { apiKey: string; model: string; content: string }[] = []
  const call = makeHostCaller({
    providers: [{ id: 'gemini', apiKey: 'k1', model: 'gemini-3.7-flash' }],
    getProvider: fakeProvider((a) => seen.push(a),
      (apiKey) => (apiKey === 'k1' ? new Error('429 RESOURCE_EXHAUSTED: quota exceeded') : null)),
    keys: { entries: [keyEntry('첫째', 'k1'), keyEntry('둘째', 'k2')] },
  })

  const out = await call(MODEL, '가려진 글', REQ)

  assert.equal(out.text, '답')
  assert.deepEqual(seen.map((s) => s.apiKey), ['k1', 'k2'])
})

test('★ 키를 바꿔도 관문이 내준 글을 그대로 다시 보낸다 — 원문을 다시 만들지 않는다', async () => {
  const seen: { apiKey: string; model: string; content: string }[] = []
  const call = makeHostCaller({
    providers: [{ id: 'gemini', apiKey: 'k1', model: 'gemini-3.7-flash' }],
    getProvider: fakeProvider((a) => seen.push(a),
      (apiKey) => (apiKey === 'k1' ? new Error('401 invalid api key') : null)),
    keys: { entries: [keyEntry('첫째', 'k1'), keyEntry('둘째', 'k2')] },
  })

  // 게이트웨이는 가린 글을 넘긴다. 두 번째 키에도 **그 글**이 가야 한다
  await call(MODEL, '홍○○ 사장', REQ)

  assert.deepEqual(seen.map((s) => s.content), ['홍○○ 사장', '홍○○ 사장'])
})

test('★ 키를 바꿔도 모델은 안 바꾼다 — 등급 판정은 모델 단위다', async () => {
  const seen: { apiKey: string; model: string; content: string }[] = []
  const call = makeHostCaller({
    providers: [{ id: 'gemini', apiKey: 'k1', model: '설정모델' }],
    getProvider: fakeProvider((a) => seen.push(a),
      (apiKey) => (apiKey === 'k1' ? new Error('429 quota exceeded') : null)),
    keys: { entries: [keyEntry('첫째', 'k1'), keyEntry('둘째', 'k2')] },
  })

  await call(MODEL, '가려진 글', REQ)

  assert.deepEqual(seen.map((s) => s.model), ['gemini-3.7-flash', 'gemini-3.7-flash'],
    '다른 모델로 넘어가면 관문이 판정한 그 모델이 아니다')
})

test('키 문제가 아닌 실패는 키를 태우지 않는다 — 다음 판에 쓸 것이 남아야 한다', async () => {
  const seen: string[] = []
  const call = makeHostCaller({
    providers: [{ id: 'gemini', apiKey: 'k1', model: 'm' }],
    getProvider: fakeProvider((a) => seen.push(a.apiKey), () => new Error('fetch failed')),
    keys: { entries: [keyEntry('첫째', 'k1'), keyEntry('둘째', 'k2')] },
  })

  await assert.rejects(() => call(MODEL, '가려진 글', REQ), /fetch failed/)
  assert.deepEqual(seen, ['k1'])
})

test('키가 하나면 한 번만 부른다 — 회귀 없음', async () => {
  const seen: string[] = []
  const call = makeHostCaller({
    providers: [{ id: 'gemini', apiKey: 'k1', model: 'm' }],
    getProvider: fakeProvider((a) => seen.push(a.apiKey), () => null),
    keys: { entries: [keyEntry('하나', 'k1')] },
  })

  await call(MODEL, '가려진 글', REQ)

  assert.deepEqual(seen, ['k1'])
})

test('관문이 막은 모델은 이 함수까지 오지 않는다 — 관문은 게이트웨이에 있다', () => {
  const src = readFileSync(new URL('./host-caller.ts', import.meta.url), 'utf8')
  assert.ok(!src.includes('docClass'), '호출자가 등급을 스스로 판정하면 길목이 둘이 된다')
  const gw = readFileSync(new URL('../../../../../packages/ai-gateway/src/gateway.ts', import.meta.url), 'utf8')
  const gate = gw.indexOf('deps.gate(model, req)')
  assert.ok(gate > 0 && gate < gw.indexOf('deps.call(model'),
    '관문이 호출보다 뒤에 서면 막은 모델로도 문서가 나간다')
})

test('토큰 수를 못 받으면 0 이 아니라 어림을 쓴다 — 0 이면 한도가 영원히 안 찬다', () => {
  assert.ok(estimateTokens('가나다라') >= 1)
  assert.ok(estimateTokens('') >= 1)
})
