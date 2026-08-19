// lib/ai/gemini-call.ts — 공통 호출기 가드
//
// 왜(v0.7.571): 27개 파일이 각자 fetch를 조립하면서 **타임아웃이 0곳**이었다. 모델이 매달리면
// 화면은 "분석 중…"에 고정되고(실측 33초/84초), 429·503 한 번이면 그대로 실패했다.
// 여기서 잠그는 계약: ① 모든 호출에 타임아웃이 붙는다 ② 재시도로 안 풀리는 실패는 재시도하지 않는다
// ③ 모든 실패가 사용자가 읽을 수 있는 말을 갖는다(조용히 삼키지 않는다).

import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  GEMINI_MAX_OUTPUT_TOKENS,
  GeminiCallError,
  callGeminiJson,
} from './gemini-call.ts'
import { DEFAULT_GEMINI_MODEL } from './gemini-model.ts'

type Reply = { status: number; body?: unknown }

const realFetch = globalThis.fetch
const calls: { url: string; init: RequestInit }[] = []

/** 순서대로 소비되는 응답 큐. 큐가 마르면 마지막 응답을 계속 돌려준다. */
function stubFetch(replies: Reply[]): void {
  let i = 0
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init })
    const r = replies[Math.min(i++, replies.length - 1)]
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {},
    }
  }) as unknown as typeof fetch
}

/** 정상 JSON 응답 한 건. */
function okBody(text: string, finishReason = 'STOP'): unknown {
  return {
    candidates: [{ content: { parts: [{ text }] }, finishReason }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
  }
}

afterEach(() => {
  globalThis.fetch = realFetch
  calls.length = 0
})

describe('요청 조립', () => {
  it('★ 모든 호출에 타임아웃 신호가 붙는다 — 없으면 화면이 영원히 "분석 중…"에 멈춘다', async () => {
    stubFetch([{ status: 200, body: okBody('{"a":1}') }])
    await callGeminiJson({ prompt: 'p', apiKey: 'k' })
    assert.equal(calls.length, 1)
    assert.ok(calls[0].init.signal, 'signal 이 없으면 요청이 안 끝나도 아무도 못 끊는다')
  })

  it('JSON 모드와 출력 상한을 실어 보낸다 — 상한이 곧 무손실의 전제다', async () => {
    stubFetch([{ status: 200, body: okBody('{"a":1}') }])
    await callGeminiJson({ prompt: '회의 본문', apiKey: 'k' })
    const body = JSON.parse(String(calls[0].init.body))
    assert.equal(body.generationConfig.responseMimeType, 'application/json')
    assert.equal(body.generationConfig.maxOutputTokens, GEMINI_MAX_OUTPUT_TOKENS)
    assert.equal(body.contents[0].parts[0].text, '회의 본문')
  })

  it('설정 모델이 쓸 수 있으면 그 모델부터 부른다 — 어드민 선택을 존중한다', async () => {
    stubFetch([{ status: 200, body: okBody('{"a":1}') }])
    const r = await callGeminiJson({ prompt: 'p', apiKey: 'k', model: 'gemini-3.7-flash' })
    assert.ok(calls[0].url.includes('gemini-3.7-flash'))
    assert.equal(r.model, 'gemini-3.7-flash')
    assert.equal(r.fallbackNotice, null)
  })
})

describe('성공 경로', () => {
  it('파싱 결과와 토큰 사용량을 함께 돌려준다', async () => {
    stubFetch([{ status: 200, body: okBody('{"summary":"요약"}') }])
    const r = await callGeminiJson({ prompt: 'p', apiKey: 'k' })
    assert.deepEqual(r.value, { summary: '요약' })
    assert.deepEqual(r.usage, { prompt: 10, output: 20, total: 30 })
  })

  it('★ 산문에 섞여 와도 건져낸다 — 여기서 죽으면 사용자는 이유를 모른 채 실패만 본다', async () => {
    stubFetch([{ status: 200, body: okBody('알겠습니다.\n{"summary":"요약"}\n감사합니다.') }])
    const r = await callGeminiJson({ prompt: 'p', apiKey: 'k' })
    assert.deepEqual(r.value, { summary: '요약' })
  })
})

describe('모델 폴백', () => {
  it('★ 404 모델은 버리고 다음 모델로 간다 — 죽은 모델 하나가 기능 전체를 죽이지 않는다', async () => {
    stubFetch([{ status: 404 }, { status: 200, body: okBody('{"a":1}') }])
    const r = await callGeminiJson({ prompt: 'p', apiKey: 'k', model: 'gemini-2.0-flash' })
    assert.deepEqual(r.value, { a: 1 })
    assert.equal(r.model, DEFAULT_GEMINI_MODEL)
  })

  it('★ 대체했으면 그 사실을 알린다 — 조용히 바꾸면 왜 결과가 다른지 아무도 모른다', async () => {
    stubFetch([{ status: 404 }, { status: 200, body: okBody('{"a":1}') }])
    const r = await callGeminiJson({ prompt: 'p', apiKey: 'k', model: 'gemini-2.0-flash' })
    assert.ok(r.fallbackNotice)
    assert.ok(r.fallbackNotice.includes(DEFAULT_GEMINI_MODEL))
  })

  it('★ JSON 대신 산문만 내는 모델은 재시도하지 않고 다음 모델로 — 같은 모델에 또 물어야 답이 같다', async () => {
    stubFetch([
      { status: 200, body: okBody('*   Input text: ... 사고과정만 있고 JSON이 없음') },
      { status: 200, body: okBody('{"a":1}') },
    ])
    const r = await callGeminiJson({ prompt: 'p', apiKey: 'k' })
    assert.deepEqual(r.value, { a: 1 })
    assert.equal(calls.length, 2, '같은 모델로 재시도했으면 호출이 3번 이상이다')
  })

  it('JSON을 못 내는 설정 모델(Gemma)은 아예 부르지 않는다', async () => {
    stubFetch([{ status: 200, body: okBody('{"a":1}') }])
    await callGeminiJson({ prompt: 'p', apiKey: 'k', model: 'gemma-4-26b-a4b-it' })
    assert.ok(!calls.some((c) => c.url.includes('gemma')))
  })
})

describe('재시도로 안 풀리는 실패는 즉시 말한다', () => {
  it('★ 401은 재시도하지 않는다 — "다시 시도해 주세요"라고 해놓고 100% 또 실패하면 안 된다', async () => {
    stubFetch([{ status: 401 }])
    await assert.rejects(
      () => callGeminiJson({ prompt: 'p', apiKey: 'bad' }),
      (e: unknown) => {
        assert.ok(e instanceof GeminiCallError)
        assert.equal(e.reason, 'auth')
        assert.ok(e.userMessage.includes('관리자 설정'))
        return true
      }
    )
    assert.equal(calls.length, 1)
  })

  it('★ 출력 상한에서 잘리면 "파싱 실패"로 뭉뚱그리지 않고 잘렸다고 말한다', async () => {
    stubFetch([{ status: 200, body: okBody('{"a":1', 'MAX_TOKENS') }])
    await assert.rejects(
      () => callGeminiJson({ prompt: 'p', apiKey: 'k' }),
      (e: unknown) => {
        assert.ok(e instanceof GeminiCallError)
        assert.equal(e.reason, 'truncated')
        assert.ok(e.userMessage.includes('나눠서'), '무엇을 하면 되는지 말해야 한다')
        return true
      }
    )
  })

  it('API 키가 없으면 부르기 전에 막는다 — 헛된 왕복을 만들지 않는다', async () => {
    stubFetch([{ status: 200, body: okBody('{"a":1}') }])
    await assert.rejects(
      () => callGeminiJson({ prompt: 'p', apiKey: '' }),
      (e: unknown) => {
        assert.ok(e instanceof GeminiCallError)
        assert.equal(e.reason, 'auth')
        return true
      }
    )
    assert.equal(calls.length, 0)
  })
})

describe('전부 실패했을 때', () => {
  it('★ 모든 모델이 죽으면 사용자가 읽을 수 있는 말과 시도 경로를 함께 준다', async () => {
    stubFetch([{ status: 404 }])
    await assert.rejects(
      () => callGeminiJson({ prompt: 'p', apiKey: 'k' }),
      (e: unknown) => {
        assert.ok(e instanceof GeminiCallError)
        assert.ok(e.userMessage.length > 0)
        assert.ok(e.attempts.length >= 2, '어떤 모델을 시도했는지 남아야 원인을 찾는다')
        return true
      }
    )
  })

  it('★ 전부 산문만 내면 모델을 바꾸라고 구체적으로 안내한다', async () => {
    stubFetch([{ status: 200, body: okBody('JSON이 아닌 설명') }])
    await assert.rejects(
      () => callGeminiJson({ prompt: 'p', apiKey: 'k' }),
      (e: unknown) => {
        assert.ok(e instanceof GeminiCallError)
        assert.equal(e.reason, 'bad_json')
        assert.ok(e.userMessage.includes(DEFAULT_GEMINI_MODEL))
        assert.ok(e.userMessage.includes('Gemma'))
        return true
      }
    )
  })

  it('전체 데드라인을 넘기면 더 시도하지 않는다 — 몇 분씩 매달리지 않는다', async () => {
    stubFetch([{ status: 500 }])
    await assert.rejects(
      () => callGeminiJson({ prompt: 'p', apiKey: 'k', overallTimeoutMs: 0 }),
      (e: unknown) => {
        assert.ok(e instanceof GeminiCallError)
        assert.equal(e.reason, 'timeout')
        return true
      }
    )
    assert.equal(calls.length, 0, '데드라인이 지났으면 한 번도 부르지 않는다')
  })
})
