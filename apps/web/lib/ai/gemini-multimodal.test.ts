// 공용 AI 호출부의 멀티모달·스트리밍 계약 (v0.7.678)
//
// 왜 생겼나(실측 2026-09-02): GPU 통합입력이 PDF·이미지를 넘겨야 해서 공용부를 못 쓰고
// 자기 fetch 를 갖고 있었다. 그 경로에만 재시도·모델 폴백·시간 제한이 없어
// 무료 티어 한도(모델당 하루 20회, quotaId GenerateRequestsPerDayPerProjectPerModel-FreeTier)에
// 걸린 날 첫 호출부터 HTTP 429 로 죽었다. 같은 순간 사슬의 다른 모델 셋은 살아 있었다.
//
// 여기서 잠그는 계약:
//   ① 멀티모달을 보낼 수 있다(그래야 GPU 가 공용부를 쓴다)
//   ② 스트리밍도 같은 재시도·폴백을 탄다
//   ③ 그림이 실린 요청은 텍스트 전용 폴백 공급자로 새지 않는다
//   ④ 모델을 갈아탄 사실을 호출부가 알 수 있다

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { callGeminiJson, callGeminiText, resetQuotaCooling } from './gemini-call.ts'

const realFetch = globalThis.fetch
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let calls: { url: string; body: any }[] = []

function jsonRes(text: string) {
  return {
    ok: true, status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: {} }),
  }
}

/** SSE 본문을 흉내 낸다 — 실제 Gemini 는 `data: {...}` 줄을 흘려보낸다. */
function sseRes(chunks: string[]) {
  const enc = new TextEncoder()
  let i = 0
  return {
    ok: true, status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: enc.encode(chunks[i++]) }
            : { done: true, value: undefined },
      }),
    },
  }
}

beforeEach(() => { calls = []; resetQuotaCooling() })
afterEach(() => { globalThis.fetch = realFetch; resetQuotaCooling() })

describe('멀티모달', () => {
  it('★ parts 를 주면 그대로 실어 보낸다 — 이게 없어서 GPU 가 공용부를 못 썼다', async () => {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return jsonRes('{"ok":true}')
    }) as unknown as typeof fetch

    await callGeminiJson({
      prompt: '무시될 텍스트',
      apiKey: 'k',
      parts: [{ inlineData: { data: 'JVBERi0=', mimeType: 'application/pdf' } }, { text: '이 표를 읽어라' }],
    })

    const sent = calls[0].body.contents[0].parts
    assert.equal(sent.length, 2)
    assert.equal(sent[0].inlineData.mimeType, 'application/pdf')
    assert.equal(sent[1].text, '이 표를 읽어라')
  })

  it('parts 를 안 주면 예전 그대로 prompt 한 조각이다 — 회귀 0', async () => {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return jsonRes('{"ok":true}')
    }) as unknown as typeof fetch

    await callGeminiJson({ prompt: '평범한 요청', apiKey: 'k' })
    assert.deepEqual(calls[0].body.contents[0].parts, [{ text: '평범한 요청' }])
  })

  it('★ 그림이 실리면 텍스트 전용 폴백 공급자로 나가지 않는다 — 보내 봐야 못 본다', async () => {
    globalThis.fetch = (async (url: string) => {
      calls.push({ url: String(url), body: null })
      return { ok: false, status: 429, json: async () => ({}) }
    }) as unknown as typeof fetch

    await assert.rejects(() => callGeminiJson({
      prompt: 'p', apiKey: 'k', fallbackApiKey: 'fb',
      parts: [{ inlineData: { data: 'AAA', mimeType: 'image/png' } }],
    }))
    assert.ok(
      calls.every((c) => c.url.includes('generativelanguage')),
      'Gemini 외 호스트로 나간 요청이 있으면 안 된다',
    )
  })

  it('텍스트만이면 폴백 공급자로 갈 수 있다 — 과차단하면 안전망이 죽는다', async () => {
    globalThis.fetch = (async (url: string) => {
      calls.push({ url: String(url), body: null })
      if (String(url).includes('generativelanguage')) return { ok: false, status: 429, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"v":1}' } }] }) }
    }) as unknown as typeof fetch

    const r = await callGeminiJson({ prompt: 'p', apiKey: 'k', fallbackApiKey: 'fb' })
    assert.deepEqual(r.value, { v: 1 })
    assert.ok(calls.some((c) => !c.url.includes('generativelanguage')))
  })
})

describe('스트리밍', () => {
  it('★ onDelta 를 주면 스트리밍 endpoint 를 쓰고 토큰을 흘려보낸다', async () => {
    globalThis.fetch = (async (url: string) => {
      calls.push({ url: String(url), body: null })
      return sseRes([
        'data: {"candidates":[{"content":{"parts":[{"text":"{\\"a\\":"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"1}"}]}}],"usageMetadata":{"totalTokenCount":9}}\n\n',
      ])
    }) as unknown as typeof fetch

    const seen: string[] = []
    const r = await callGeminiJson({ prompt: 'p', apiKey: 'k', onDelta: (d) => seen.push(d) })

    assert.ok(calls[0].url.includes(':streamGenerateContent'), '스트리밍 endpoint 를 써야 한다')
    assert.ok(calls[0].url.includes('alt=sse'))
    assert.deepEqual(r.value, { a: 1 })
    assert.equal(seen.join(''), '{"a":1}', '토큰이 오는 대로 흘러야 한다')
    assert.equal(r.usage.total, 9)
  })

  it('★ 스트리밍도 한도에 걸리면 다음 모델로 간다 — 이 한 줄이 이번 사고의 해법이다', async () => {
    const models: string[] = []
    globalThis.fetch = (async (url: string) => {
      const m = String(url).split('/models/')[1].split(':')[0]
      models.push(m)
      // 설정 모델은 하루치를 다 쓴 상태 — 재시도해도 계속 429 다(실측 그대로)
      if (m === 'gemini-3-flash-preview') return { ok: false, status: 429, json: async () => ({}) }
      return sseRes(['data: {"candidates":[{"content":{"parts":[{"text":"{\\"ok\\":1}"}]}}]}\n\n'])
    }) as unknown as typeof fetch

    const r = await callGeminiJson({
      prompt: 'p', apiKey: 'k', model: 'gemini-3-flash-preview',
      onDelta: () => {},
    })
    assert.equal(models[0], 'gemini-3-flash-preview', '설정 모델을 먼저 부른다')
    assert.ok(models.length > 1, '한도에 걸렸으면 다음 모델로 가야 한다')
    assert.deepEqual(r.value, { ok: 1 })
    assert.ok(r.fallbackNotice, '모델을 갈아탔으면 그 사실을 알린다')
  })

  it('모델을 갈아타면 onAttempt 로 알린다 — 화면이 「다시 시도합니다」를 띄울 수 있게', async () => {
    let n = 0
    globalThis.fetch = (async () => {
      n += 1
      if (n === 1) return { ok: false, status: 404, json: async () => ({}) }
      return jsonRes('{"ok":1}')
    }) as unknown as typeof fetch

    const seen: string[] = []
    await callGeminiJson({ prompt: 'p', apiKey: 'k', onAttempt: (i) => seen.push(i.model) })
    assert.ok(seen.length >= 1, '두 번째 시도부터는 알려야 한다')
  })
})

describe('텍스트 호출', () => {
  it('★ 산문을 요구하면 JSON 모드를 걸지 않는다 — 프롬프트 자가합성이 여기 온다', async () => {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return jsonRes('그냥 산문입니다')
    }) as unknown as typeof fetch

    const r = await callGeminiText({ prompt: 'p', apiKey: 'k' })
    assert.equal(r.text, '그냥 산문입니다')
    assert.equal(calls[0].body.generationConfig.responseMimeType, undefined)
  })

  it('산문 호출은 폴백 공급자(JSON 전용)로 새지 않는다', async () => {
    globalThis.fetch = (async (url: string) => {
      calls.push({ url: String(url), body: null })
      return { ok: false, status: 429, json: async () => ({}) }
    }) as unknown as typeof fetch

    await assert.rejects(() => callGeminiText({ prompt: 'p', apiKey: 'k', fallbackApiKey: 'fb' }))
    assert.ok(calls.every((c) => c.url.includes('generativelanguage')))
  })

  it('responseJson 을 주면 JSON 모드를 건다 — GPU 의 jsonMode=true 경로', async () => {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return jsonRes('{"x":1}')
    }) as unknown as typeof fetch

    await callGeminiText({ prompt: 'p', apiKey: 'k', responseJson: true })
    assert.equal(calls[0].body.generationConfig.responseMimeType, 'application/json')
  })
})

describe('전부 막혔을 때 하는 말', () => {
  // E-6: 이 상태는 「그날의 한도가 실제로 소진돼 있어야」 재현된다 —
  //   실브라우저에서 한 번 밟았고(2026-09-02 15:5x KST, /pricing/gpu?tab=intake),
  //   그 뒤 태평양시 자정에 리셋돼 다시 밟을 수 없다. 그래서 계산으로 잠근다.
  //
  //   실측 앵커(그때 화면에 실제로 뜬 문구):
  //     「원문 전사를 건너뜁니다 — AI 호출 한도를 모두 썼습니다. 무료 등급은 모델마다
  //      하루 사용량이 정해져 있어요 — 내일 다시 되거나, 관리자 설정에서 다른 AI 모델로
  //      바꾸면 이어서 쓸 수 있습니다. (누락 검사가 꺼진 채 진행됩니다)」
  //   그 뒤 표준 #164(두괄식·키워드 우선)를 받아 「AI 한도 초과 · 오늘 사용량 소진 — …」으로
  //   바꿨다. 뜻은 같고 첫 구절만 키워드가 됐다.
  //   아래 단정이 깨지면 그 문장이 화면에서 달라진 것이다.

  it('★ 한도로 전부 막히면 「모델을 바꾸거나 내일」이라고 말한다 — 「잠시 후 다시」가 아니다', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch
    try {
      await callGeminiJson({ prompt: 'p', apiKey: 'k' })
      assert.fail('한도로 전부 막혔으면 실패해야 한다')
    } catch (e) {
      const err = e as { reason: string; userMessage: string }
      assert.equal(err.reason, 'quota')
      assert.match(err.userMessage, /^AI 한도 초과 · /, '두괄식 — 첫 구절이 «상태 · 원인» 키워드다(표준 #164)')
      assert.match(err.userMessage, /사용량 소진/, '왜 막혔는지 설명해야 한다')
      assert.match(err.userMessage, /다른 AI 모델로 바꾸면/, '지금 할 수 있는 일을 알려줘야 한다')
      assert.doesNotMatch(err.userMessage, /본문이 길면/, '본문 길이를 의심하게 만들면 안 된다')
    }
  })

  it('★ 예산이 먼저 끝나도 원인이 한도였으면 한도라고 말한다 — 실측에서 이게 틀렸다', async () => {
    // 첫 호출은 429, 그 사이 예산이 소진되도록 상한을 아주 짧게 준다
    globalThis.fetch = (async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch
    try {
      await callGeminiJson({ prompt: 'p', apiKey: 'k', overallTimeoutMs: 1 })
      assert.fail('예산이 끝났으면 실패해야 한다')
    } catch (e) {
      const err = e as { reason: string; userMessage: string }
      // 아직 아무것도 못 불렀으면 timeout 이 맞다. 한 번이라도 한도를 봤으면 한도다.
      assert.ok(['quota', 'timeout'].includes(err.reason))
      if (err.reason === 'quota') assert.match(err.userMessage, /^AI 한도 초과 · /)
    }
  })

  it('시간 초과는 여전히 시간 초과라고 말한다 — 과교정하면 반대 사고가 난다', async () => {
    globalThis.fetch = (async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }) }) as unknown as typeof fetch
    try {
      await callGeminiJson({ prompt: 'p', apiKey: 'k' })
      assert.fail('실패해야 한다')
    } catch (e) {
      const err = e as { userMessage: string }
      assert.match(err.userMessage, /^AI 응답 지연 · /)
    }
  })
})
