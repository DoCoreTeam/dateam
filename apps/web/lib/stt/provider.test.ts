/**
 * 전사 창구 — **힌트 때문에 본문을 잃지 않는다**
 *
 * **왜 생겼나 (실측 2026-09-30)**: 52분짜리 회의의 네 구간은 전사됐고 한 구간(30~40분)만
 * `FAILED` 였다. 사유는 업체가 준 400 이고 내용은
 * `prompt length must be 896 characters or fewer, but provided prompt contains 936 characters` 다.
 *
 * 여기서 말하는 prompt 는 **앞 구간의 끝 몇 줄**이다. 고유명사가 구간 경계에서 흔들리는 걸
 * 줄이려고 같이 보내는 힌트이지, 전사에 **필요한 것이 아니다.**
 * 있으면 좋은 것 하나 때문에 10분치 소리를 통째로 버린 것이 이 사고다.
 *
 * 그래서 규칙은 하나다 — **힌트가 거절당하면 힌트를 빼고 다시 보낸다.**
 * 본문은 어떤 경우에도 안 버린다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { openAiCompatibleStt, SttError, isPromptRejection } from './provider.ts'
import type { AiLedger } from '../ai/guarded-call.ts'
import type { KeyPoolEntry } from '../ai/key-rotation.ts'

const realFetch = globalThis.fetch

const VERBOSE_JSON = { segments: [{ start: 0, end: 1, text: '안녕하세요' }], text: '안녕하세요' }

/** 실측 원문 — 업체가 실제로 돌려준 몸통이다 */
const PROMPT_TOO_LONG =
  '{"error":{"message":"prompt length must be 896 characters or fewer, but provided prompt contains 936 characters","type":"invalid_request_error"}}'

function fakeLedger(): { ledger: AiLedger; calls: number } {
  const state = { ledger: null as unknown as AiLedger, calls: 0 }
  state.ledger = { recordCall: async () => { state.calls += 1 }, recordTransfer: async () => {} }
  return state as { ledger: AiLedger; calls: number }
}

function keyEntry(label: string, apiKey: string): KeyPoolEntry {
  return {
    id: label, provider: 'groq', label, apiKey,
    priority: 0, isActive: true, cooldownUntil: null,
    disabledReason: null, consecutiveFailures: 0,
  }
}

/** 나간 요청의 form 을 그대로 모은다 — 「prompt 를 정말 뺐나」는 값으로만 셀 수 있다 */
function spyFetch(reply: (n: number) => { ok: boolean; status: number; body: string }) {
  const forms: FormData[] = []
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    forms.push(init.body as FormData)
    const r = reply(forms.length)
    return {
      ok: r.ok,
      status: r.status,
      text: async () => r.body,
      json: async () => (r.ok ? VERBOSE_JSON : {}),
    }
  }) as unknown as typeof fetch
  return forms
}

function stt(ledger: AiLedger) {
  return openAiCompatibleStt({
    vendor: 'groq', endpoint: 'https://example.test/v1/audio/transcriptions',
    apiKey: 'k1', model: 'whisper-large', ledger,
    keys: { entries: [keyEntry('하나', 'k1')] },
  })
}

const INPUT = {
  bytes: new Uint8Array([1, 2, 3]).buffer as unknown as Buffer,
  mimeType: 'audio/webm',
  filename: 'a.webm',
  actorId: null,
}

/* ── 힌트가 거절당해도 본문은 살린다 ─────────────────────── */

test('★ 힌트 때문에 400 이 오면 힌트를 빼고 다시 보낸다 — 본문을 버리지 않는다', async () => {
  const forms = spyFetch((n) => (n === 1
    ? { ok: false, status: 400, body: PROMPT_TOO_LONG }
    : { ok: true, status: 200, body: '' }))
  try {
    const out = await stt(fakeLedger().ledger).transcribe({ ...INPUT, priorContext: '앞 구간의 끝'.repeat(50) })
    assert.equal(out.segments.length, 1, '되살릴 수 있는 실패인데 구간을 버렸다')
    assert.equal(forms.length, 2, '한 번 보내고 포기했다')
  } finally { globalThis.fetch = realFetch }
})

test('★ 두 번째 요청에는 힌트가 아예 안 실린다 — 같은 것을 다시 보내면 같은 400 이다', async () => {
  const forms = spyFetch((n) => (n === 1
    ? { ok: false, status: 400, body: PROMPT_TOO_LONG }
    : { ok: true, status: 200, body: '' }))
  try {
    await stt(fakeLedger().ledger).transcribe({ ...INPUT, priorContext: '문맥'.repeat(100) })
    assert.ok(forms[0].get('prompt'), '첫 요청에 힌트가 없다 — 시험이 헛돈다')
    assert.equal(forms[1].get('prompt'), null, '두 번째에도 힌트를 실었다')
    // 본문(소리)은 두 번 다 그대로 간다
    assert.ok(forms[1].get('file'), '두 번째 요청에 소리가 없다')
    assert.equal(forms[1].get('model'), 'whisper-large')
  } finally { globalThis.fetch = realFetch }
})

test('★ 힌트와 무관한 400 은 두 번 보내지 않는다 — 같은 실패를 두 배로 치르지 않는다', async () => {
  const forms = spyFetch(() => ({ ok: false, status: 400, body: '{"error":{"message":"Invalid file format"}}' }))
  try {
    await assert.rejects(
      () => stt(fakeLedger().ledger).transcribe({ ...INPUT, priorContext: '문맥' }),
      (e: unknown) => e instanceof SttError,
    )
    assert.equal(forms.length, 1)
  } finally { globalThis.fetch = realFetch }
})

test('★ 힌트를 안 보냈으면 400 에 다시 보내지 않는다 — 뺄 것이 없다', async () => {
  const forms = spyFetch(() => ({ ok: false, status: 400, body: PROMPT_TOO_LONG }))
  try {
    await assert.rejects(() => stt(fakeLedger().ledger).transcribe({ ...INPUT }))
    assert.equal(forms.length, 1, '보낸 적 없는 힌트를 빼겠다고 한 번 더 보냈다')
  } finally { globalThis.fetch = realFetch }
})

test('★ 힌트를 빼고도 실패하면 사유에 보낸 힌트 길이를 적는다 — 다음 실패가 스스로 원인을 말한다', async () => {
  const forms = spyFetch(() => ({ ok: false, status: 400, body: PROMPT_TOO_LONG }))
  try {
    const err = await stt(fakeLedger().ledger)
      .transcribe({ ...INPUT, priorContext: 'ㄱ'.repeat(777) })
      .then(() => null, (e: unknown) => e as SttError)
    assert.ok(err instanceof SttError)
    assert.match(err.userMessage, /힌트 777자/, `사유에 길이가 없다: ${err.userMessage}`)
    assert.equal(forms.length, 2)
  } finally { globalThis.fetch = realFetch }
})

test('원장은 시도마다 남는다 — 힌트를 빼고 다시 보낸 것도 한 번 나간 것이다', async () => {
  spyFetch((n) => (n === 1
    ? { ok: false, status: 400, body: PROMPT_TOO_LONG }
    : { ok: true, status: 200, body: '' }))
  const lg = fakeLedger()
  try {
    await stt(lg.ledger).transcribe({ ...INPUT, priorContext: '문맥'.repeat(80) })
    assert.equal(lg.calls, 2, '두 번 나갔는데 원장에 한 번만 남았다')
  } finally { globalThis.fetch = realFetch }
})

test('잘 되면 한 번만 보낸다 — 회귀 없음', async () => {
  const forms = spyFetch(() => ({ ok: true, status: 200, body: '' }))
  try {
    const out = await stt(fakeLedger().ledger).transcribe({ ...INPUT, priorContext: '문맥' })
    assert.equal(out.segments.length, 1)
    assert.equal(forms.length, 1)
  } finally { globalThis.fetch = realFetch }
})

/* ── 판정 자체 ──────────────────────────────────────────── */

test('힌트 거절 판정은 400 이면서 몸통이 prompt 를 말할 때만이다', () => {
  assert.equal(isPromptRejection(400, PROMPT_TOO_LONG), true)
  assert.equal(isPromptRejection(400, 'Invalid file format'), false, '아무 400 이나 힌트 탓으로 돌린다')
  assert.equal(isPromptRejection(429, PROMPT_TOO_LONG), false, '한도인데 힌트를 뺀다')
  assert.equal(isPromptRejection(500, PROMPT_TOO_LONG), false)
})

test('★ 힌트는 보내기 전에 업체 상한 아래로 자른다 — 자르고도 거절당하면 그때 빼는 것이다', () => {
  // 두 겹이다. 자르기가 첫 겹이고 빼고 다시 보내기가 둘째 겹이다.
  // 첫 겹만 두면 오늘 같은 일(자르는데도 936 이 나간 일)에 또 당한다.
  const text = readFileSync(new URL('./provider.ts', import.meta.url), 'utf8')
  assert.match(text, /MAX_PROMPT_CHARS/, '상한이 이름으로 안 박혀 있다')
  const m = text.match(/MAX_PROMPT_CHARS\s*=\s*(\d+)/)
  assert.ok(m && Number(m[1]) <= 896, `상한이 업체 한계(896)보다 크다: ${m?.[1]}`)
})
