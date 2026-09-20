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
  isQuotaCooling, resetQuotaCooling, QUOTA_COOLDOWN_MS,
  type GeminiKeyPool,
} from './gemini-call.ts'
import type { KeyPoolEntry, KeyOutcome } from './key-pool.ts'
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

/* ── 두 번째 공급자 폴백 + 한도 회로 차단기 ─────────────────────────
 * 왜(실측 2026-08-27): 조직 키가 무료 티어였다 — quotaId …PerProjectPerModel-FreeTier, 값 20.
 * 한도가 **프로젝트 단위**라 모델을 바꿔도 같이 막힌다. 모델 폴백만으로는 못 푼다.
 * 여기서 잠그는 계약:
 *   ① 폴백 키를 준 호출만 다른 공급자로 나간다(주지 않은 기능이 몰래 새면 안 된다)
 *   ② 사슬 전체가 한도로 막힌 직후에는 두드리지 않고 건너뛴다(헛호출 270회를 막는다)
 *   ③ Gemini 가 다시 답하면 냉각은 즉시 풀린다
 */
describe('두 번째 공급자 폴백', () => {
  afterEach(() => { resetQuotaCooling() })

  it('★ 폴백 키를 주지 않으면 다른 공급자로 나가지 않는다 — 데이터가 몰래 새면 안 된다', async () => {
    resetQuotaCooling()
    stubFetch([{ status: 429 }])
    await assert.rejects(() => callGeminiJson({ prompt: 'p', apiKey: 'k' }))
    assert.ok(
      calls.every((c) => c.url.includes('generativelanguage')),
      'Gemini 외의 호스트로 나간 요청이 있으면 안 된다',
    )
  })

  it('★ 사슬이 전부 한도로 막히면 폴백 공급자로 넘어가 결과를 낸다', async () => {
    resetQuotaCooling()
    let i = 0
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init })
      i += 1
      if (String(url).includes('generativelanguage')) {
        return { ok: false, status: 429, json: async () => ({}) }
      }
      return {
        ok: true, status: 200,
        json: async () => ({ choices: [{ message: { content: '{"found":true}' } }] }),
      }
    }) as unknown as typeof fetch

    const res = await callGeminiJson({ prompt: 'p', apiKey: 'k', fallbackApiKey: 'fb' })
    assert.deepEqual(res.value, { found: true })
    assert.ok(res.fallbackNotice, '다른 공급자로 처리했으면 화면에 그 사실이 전달돼야 한다')
    assert.ok(i > 1)
  })

  it('★ 한도로 막힌 직후의 호출은 Gemini 를 두드리지 않는다', async () => {
    resetQuotaCooling()
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init })
      if (String(url).includes('generativelanguage')) {
        return { ok: false, status: 429, json: async () => ({}) }
      }
      return {
        ok: true, status: 200,
        json: async () => ({ choices: [{ message: { content: '{"ok":1}' } }] }),
      }
    }) as unknown as typeof fetch

    await callGeminiJson({ prompt: 'p', apiKey: 'k', fallbackApiKey: 'fb' })
    assert.ok(isQuotaCooling(), '한도를 확인했으면 기억한다')

    calls.length = 0
    await callGeminiJson({ prompt: 'p2', apiKey: 'k', fallbackApiKey: 'fb' })
    assert.equal(
      calls.filter((c) => c.url.includes('generativelanguage')).length, 0,
      '두 번째 호출은 Gemini 를 한 번도 부르지 않는다',
    )
  })

  it('냉각 창은 분 단위다 — 너무 짧으면 무의미하고 너무 길면 안 돌아온다', () => {
    assert.ok(QUOTA_COOLDOWN_MS >= 60_000)
    assert.ok(QUOTA_COOLDOWN_MS <= 60 * 60_000)
  })
})

describe('한도를 한도라고 부른다 (P0030 I02)', () => {
  // 실측 2026-09-20: 한도로 막힌 호출 23,096건이 「AI 연결 실패 · 서버 응답 없음 —
  // 잠시 후 다시 시도해 주세요」로 올라갔다. 사용자는 본문을 줄이거나 새로고침을 했고,
  // 부르는 쪽(발견 루프)은 한도가 아니라고 읽어 남은 대조쌍을 끝까지 두드렸다.
  afterEach(() => { resetQuotaCooling() })

  /** 1회차로 냉각을 켠다 — 사슬 전부 429, 폴백은 성공 */
  async function warmCooling(): Promise<void> {
    globalThis.fetch = (async (url: string) => {
      const u = String(url)
      if (u.includes('generativelanguage')) return { ok: false, status: 429, json: async () => ({}) }
      return {
        ok: true, status: 200,
        json: async () => ({ choices: [{ message: { content: '{"ok":1}' } }] }),
      }
    }) as unknown as typeof fetch
    await callGeminiJson({ prompt: 'warm', apiKey: 'k', fallbackApiKey: 'fb' })
    assert.ok(isQuotaCooling(), '냉각이 켜져야 다음 회차가 Gemini 를 건너뛴다')
  }

  it('★ Gemini 를 건너뛴 뒤 폴백이 한도와 무관하게 실패해도 이유는 quota 다', async () => {
    // 이 경우가 핵심이다. 폴백이 429 로 죽으면 폴백 쪽 이유가 quota 라 어차피 맞는다.
    // 폴백이 **다른 이유로** 죽을 때, 사슬이 한 바퀴도 안 돌아 lastReason 이 초기값
    // 'server' 로 남던 자리가 드러난다. Gemini 를 건너뛴 이유는 여전히 한도다.
    await warmCooling()

    // 폴백은 200 이지만 본문이 비어 있다 → HTTP 상태가 없는 실패
    globalThis.fetch = (async () => ({
      ok: true, status: 200, json: async () => ({ choices: [] }),
    })) as unknown as typeof fetch

    const err = await callGeminiJson({ prompt: 'p2', apiKey: 'k', fallbackApiKey: 'fb' })
      .then(() => null, (e: unknown) => e)

    assert.ok(err instanceof GeminiCallError, '실패는 GeminiCallError 로 올라온다')
    assert.equal(
      err.reason, 'quota',
      'Gemini 를 건너뛴 이유가 한도인데 server 로 올라오면 '
      + '부르는 쪽의 멈춤 장치가 안 걸린다 (실측 23,096건이 그 자리였다)',
    )
  })

  it('폴백이 429 면 그것도 quota 다', async () => {
    await warmCooling()
    globalThis.fetch = (async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch
    const err = await callGeminiJson({ prompt: 'p3', apiKey: 'k', fallbackApiKey: 'fb' })
      .then(() => null, (e: unknown) => e as GeminiCallError)
    assert.equal(err!.reason, 'quota')
  })

  it('★ 그때 사용자 문구가 「잠시 후 다시」가 아니라 한도 안내다', async () => {
    globalThis.fetch = (async (url: string) => {
      const u = String(url)
      if (u.includes('generativelanguage')) return { ok: false, status: 429, json: async () => ({}) }
      return {
        ok: true, status: 200,
        json: async () => ({ choices: [{ message: { content: '{"ok":1}' } }] }),
      }
    }) as unknown as typeof fetch
    await callGeminiJson({ prompt: 'p', apiKey: 'k', fallbackApiKey: 'fb' })

    globalThis.fetch = (async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch
    const err = await callGeminiJson({ prompt: 'p2', apiKey: 'k', fallbackApiKey: 'fb' })
      .then(() => null, (e: unknown) => e as GeminiCallError)

    assert.match(err!.userMessage, /한도/, '한도라고 말해야 사용자가 내일 다시 온다')
    assert.doesNotMatch(
      err!.userMessage, /서버 응답 없음/,
      '서버 문제로 말하면 사용자는 새로고침을 반복한다',
    )
  })

  it('폴백 키가 거부되면 기다리라고 하지 않는다', async () => {
    stubFetch([{ status: 429 }, { status: 429 }, { status: 429 }, { status: 429 }, { status: 401 }])
    const err = await callGeminiJson({ prompt: 'p', apiKey: 'k', fallbackApiKey: 'fb' })
      .then(() => null, (e: unknown) => e as GeminiCallError)

    assert.equal(err!.reason, 'auth')
    assert.match(err!.userMessage, /키/, '키를 다시 등록하라고 말해야 한다')
  })
})

/* ── 키 여러 개 ────────────────────────────────────────────────
   왜 세나: 키가 마르면 그 공급자를 쓰는 기능이 **그날 전부** 멈춘다. 그런데 이 실패는
   조용하다 — 화면에는 「AI 사용량 한도를 초과했습니다」만 뜨고, 남은 키가 있었는지는
   아무 데도 안 나온다. 그래서 「다음 키를 실제로 두드렸나」를 호출 수로 센다. */

function keyEntry(label: string, apiKey: string): KeyPoolEntry {
  return {
    id: label, provider: 'gemini', label, apiKey,
    priority: 0, isPaid: false, isActive: true, cooldownUntil: null,
    disabledReason: null, consecutiveFailures: 0,
  }
}

/** 이 호출이 어느 키를 썼나 — 헤더로 센다 */
const usedKeys = (): string[] =>
  calls.map((c) => String((c.init.headers as Record<string, string>)['x-goog-api-key']))

const QUOTA_429 = { status: 429, body: { error: { message: 'RESOURCE_EXHAUSTED: quota exceeded' } } }

describe('키 여러 개', () => {
  afterEach(() => { resetQuotaCooling() })

  it('★ 429 를 받으면 같은 모델을 다음 키로 한 번 더 부른다', async () => {
    stubFetch([QUOTA_429, { status: 200, body: okBody('{"a":1}') }])
    const keys: GeminiKeyPool = { entries: [keyEntry('첫째', 'k1'), keyEntry('둘째', 'k2')] }

    const r = await callGeminiJson({ prompt: 'p', apiKey: 'k1', model: 'gemini-3.7-flash', keys })

    assert.deepEqual(r.value, { a: 1 })
    assert.deepEqual(usedKeys(), ['k1', 'k2'], '두 번째 키로 이어 부르지 않았다')
    assert.ok(calls.every((c) => c.url.includes('gemini-3.7-flash')),
      '모델을 먼저 바꾸면 같은 키로 사슬을 다 태우고서야 다음 키에 닿는다')
  })

  it('★ 키가 하나면 호출 횟수가 전과 같다 — 키 교체가 헛호출을 늘리지 않는다', async () => {
    stubFetch([QUOTA_429, { status: 200, body: okBody('{"a":1}') }])
    const keys: GeminiKeyPool = { entries: [keyEntry('하나', 'k1')] }

    await callGeminiJson({ prompt: 'p', apiKey: 'k1', keys }).catch(() => {})
    const withPool = calls.length

    calls.length = 0
    resetQuotaCooling()
    stubFetch([QUOTA_429, { status: 200, body: okBody('{"a":1}') }])
    await callGeminiJson({ prompt: 'p', apiKey: 'k1' }).catch(() => {})

    assert.equal(withPool, calls.length)
  })

  it('★ 키를 다 쓰기 전에는 공급자 전체를 건너뛰지 않는다 — 멀쩡한 키를 두고 10분을 버리면 안 된다', async () => {
    stubFetch([QUOTA_429, { status: 200, body: okBody('{"a":1}') }])
    const keys: GeminiKeyPool = { entries: [keyEntry('첫째', 'k1'), keyEntry('둘째', 'k2')] }

    await callGeminiJson({ prompt: 'p', apiKey: 'k1', fallbackApiKey: 'fb', keys })

    assert.equal(isQuotaCooling(), false)
  })

  it('★ 키가 전부 한도면 그때 두 번째 공급자로 내려간다', async () => {
    // Gemini 는 무엇을 물어도 429, 폴백 공급자는 답한다
    let i = 0
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init })
      i += 1
      if (String(url).includes('generativelanguage')) {
        return { ok: false, status: 429, json: async () => QUOTA_429.body }
      }
      return {
        ok: true, status: 200,
        json: async () => ({ choices: [{ message: { content: '{"a":1}' } }], usage: {} }),
      }
    }) as unknown as typeof fetch

    const keys: GeminiKeyPool = { entries: [keyEntry('첫째', 'k1'), keyEntry('둘째', 'k2')] }
    const r = await callGeminiJson({ prompt: 'p', apiKey: 'k1', fallbackApiKey: 'fb', keys })

    assert.deepEqual(r.value, { a: 1 })
    assert.ok(usedKeys().includes('k2'), '두 번째 키를 건너뛰고 공급자부터 바꿨다')
    assert.ok(isQuotaCooling(), '키를 다 써 본 뒤에는 기억한다')
    assert.ok(i > 0)
  })

  it('★ 인증이 깨진 키는 즉시 끝내지 않고 다음 키로 넘어간다', async () => {
    stubFetch([{ status: 401, body: { error: { message: 'API key not valid' } } },
               { status: 200, body: okBody('{"a":1}') }])
    const keys: GeminiKeyPool = { entries: [keyEntry('깨진것', 'k1'), keyEntry('멀쩡한것', 'k2')] }

    const r = await callGeminiJson({ prompt: 'p', apiKey: 'k1', keys })

    assert.deepEqual(r.value, { a: 1 })
    assert.deepEqual(usedKeys(), ['k1', 'k2'])
  })

  it('결말이 표에 적히도록 그대로 넘어간다 — 한도는 quota, 인증은 auth, 성공은 ok', async () => {
    const seen: { label: string; outcome: KeyOutcome }[] = []
    const keys: GeminiKeyPool = {
      entries: [keyEntry('첫째', 'k1'), keyEntry('둘째', 'k2')],
      record: async (entry, outcome) => { seen.push({ label: entry.label, outcome }) },
    }
    stubFetch([QUOTA_429, { status: 200, body: okBody('{"a":1}') }])

    await callGeminiJson({ prompt: 'p', apiKey: 'k1', keys })

    assert.deepEqual(seen, [{ label: '첫째', outcome: 'quota' }, { label: '둘째', outcome: 'ok' }])
  })

  it('기록이 실패해도 호출은 그대로 끝난다', async () => {
    const keys: GeminiKeyPool = {
      entries: [keyEntry('첫째', 'k1')],
      record: async () => { throw new Error('표가 없다') },
    }
    stubFetch([{ status: 200, body: okBody('{"a":1}') }])

    const r = await callGeminiJson({ prompt: 'p', apiKey: 'k1', keys })

    assert.deepEqual(r.value, { a: 1 })
  })
})
