// lib/ai/key-rotation.test.ts — 막힌 키를 정말 건너뛰는가, 그리고 **안 막힌 키를 태우지 않는가**
//
// 두 방향으로 틀릴 수 있고 둘 다 조용하다.
//   덜 넘어가면: 키를 여러 개 넣어 뒀는데 첫 키가 마른 날 기능이 그냥 멈춘다
//   더 넘어가면: 네트워크가 한 번 튄 것으로 키를 하나씩 소진하고, 정작 한도가 찼을 때 남은 것이 없다
// 그래서 「몇 번 불렀나」를 센다.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { withProviderKeys, keyOutcomeOf } from './key-rotation.ts'
import type { KeyPoolEntry, KeyOutcome } from './key-pool.ts'

function keyEntry(label: string, apiKey: string): KeyPoolEntry {
  return {
    id: label, provider: 'gemini', label, apiKey,
    priority: 0, isActive: true, cooldownUntil: null,
    disabledReason: null, consecutiveFailures: 0,
  }
}

const QUOTA = () => new Error('429 RESOURCE_EXHAUSTED: quota exceeded')
const AUTH = () => new Error('401 Unauthorized: API key not valid')
const NETWORK = () => new Error('fetch failed: ECONNRESET')
/* 실측 2026-09-23 의 원문. 무료 키 셋이 같은 순간 같은 모델에서 이것을 냈고 유료 키는 200 이었다 */
const OVERLOAD = () => new Error('Gemini API 오류 (503): {"error":{"code":503,'
  + '"message":"This model is currently experiencing high demand. Spikes in demand are expected."}}')

/* ── 무엇을 키 문제로 보는가 ───────────────────────────────── */

test('한도와 인증과 과부하가 키 문제다 — 분류는 provider-errors 한 곳에서 온다', () => {
  assert.equal(keyOutcomeOf(QUOTA()), 'quota')
  assert.equal(keyOutcomeOf(AUTH()), 'auth')
  assert.equal(keyOutcomeOf(OVERLOAD()), 'overload')
  assert.equal(keyOutcomeOf(NETWORK()), 'transient')
  assert.equal(keyOutcomeOf(new Error('404 model not found')), 'transient',
    '모델이 없어진 것은 키를 바꿔도 같다')
})

test('★ 404 는 과부하로 새지 않는다 — 그 모델이 없어진 것이지 붐비는 것이 아니다', () => {
  // 실측 원문. 'no longer available' 안에 'available' 이 들어 있어 과부하 낱말과 스칠 수 있다
  const gone = new Error('404 This model models/gemini-2.5-flash is no longer available to new users')
  assert.equal(keyOutcomeOf(gone), 'transient', '키 문제가 아니므로 키를 안 태운다')
})

/* ── 넘어가는가 ────────────────────────────────────────────── */

test('★ 한도에 걸린 키를 건너뛰고 다음 키로 같은 일을 다시 한다', async () => {
  const used: string[] = []
  const entries = [keyEntry('첫째', 'k1'), keyEntry('둘째', 'k2')]

  const got = await withProviderKeys('gemini', 'k1', async (apiKey) => {
    used.push(apiKey)
    if (apiKey === 'k1') throw QUOTA()
    return '됐다'
  }, { entries })

  assert.equal(got, '됐다')
  assert.deepEqual(used, ['k1', 'k2'])
})

test('★ 인증이 깨진 키도 건너뛴다 — 기다려서 풀릴 일이 아니다', async () => {
  const used: string[] = []
  const entries = [keyEntry('깨진것', 'k1'), keyEntry('멀쩡한것', 'k2')]

  await withProviderKeys('gemini', 'k1', async (apiKey) => {
    used.push(apiKey)
    if (apiKey === 'k1') throw AUTH()
    return 1
  }, { entries })

  assert.deepEqual(used, ['k1', 'k2'])
})

/* ── 안 넘어가는가 ─────────────────────────────────────────── */

test('★ 네트워크 오류로는 키를 태우지 않는다 — 한도가 찼을 때 쓸 것이 남아야 한다', async () => {
  const used: string[] = []
  const entries = [keyEntry('첫째', 'k1'), keyEntry('둘째', 'k2')]

  await assert.rejects(
    () => withProviderKeys('gemini', 'k1', async (apiKey) => {
      used.push(apiKey)
      throw NETWORK()
    }, { entries }),
    /ECONNRESET/,
  )
  assert.deepEqual(used, ['k1'], '키를 바꿔도 같은 답이 올 실패에 키를 하나 더 썼다')
})

test('★ 키가 하나면 정확히 한 번 부른다 — 교체가 헛호출을 늘리지 않는다', async () => {
  let n = 0

  await withProviderKeys('gemini', 'k1', async () => { n += 1; return 'ok' },
    { entries: [keyEntry('하나', 'k1')] })

  assert.equal(n, 1)
})

test('키를 다 써도 안 되면 마지막 오류를 그대로 올린다 — 원인을 우리 말로 바꾸지 않는다', async () => {
  const entries = [keyEntry('첫째', 'k1'), keyEntry('둘째', 'k2')]

  await assert.rejects(
    () => withProviderKeys('gemini', 'k1', async () => { throw QUOTA() }, { entries }),
    /RESOURCE_EXHAUSTED/,
  )
})

/* ── 부르는 쪽이 준 키가 먼저다 ────────────────────────────── */

test('부르는 쪽이 지목한 키를 표가 덮지 않는다 — 「이 키로 시험」이 엉뚱한 키를 두드리면 안 된다', async () => {
  const used: string[] = []
  const entries = [keyEntry('표첫째', 'table1'), keyEntry('표둘째', 'table2')]

  await withProviderKeys('gemini', 'mine', async (apiKey) => { used.push(apiKey); return 1 }, { entries })

  assert.deepEqual(used, ['mine'])
})

test('같은 키가 표에도 있으면 표의 줄로 적는다 — 그래야 상태가 그 줄에 쌓인다', async () => {
  const seen: string[] = []
  const entries = [keyEntry('표에있는이름', 'k1')]

  await withProviderKeys('gemini', 'k1', async () => 1,
    { entries, record: async (entry) => { seen.push(entry.label) } })

  assert.deepEqual(seen, ['표에있는이름'])
})

/* ── 기록 ──────────────────────────────────────────────────── */

test('결말이 그대로 넘어간다 — 한도는 quota, 성공은 ok', async () => {
  const seen: { label: string; outcome: KeyOutcome }[] = []
  const entries = [keyEntry('첫째', 'k1'), keyEntry('둘째', 'k2')]

  await withProviderKeys('gemini', 'k1', async (apiKey) => {
    if (apiKey === 'k1') throw QUOTA()
    return 1
  }, { entries, record: async (entry, outcome) => { seen.push({ label: entry.label, outcome }) } })

  assert.deepEqual(seen, [{ label: '첫째', outcome: 'quota' }, { label: '둘째', outcome: 'ok' }])
})

test('★ 기록이 실패해도 호출은 그대로 끝난다', async () => {
  const got = await withProviderKeys('gemini', 'k1', async () => '됐다', {
    entries: [keyEntry('하나', 'k1')],
    record: async () => { throw new Error('표가 없다') },
  })

  assert.equal(got, '됐다')
})

test('★ 표를 못 읽어도 부르는 쪽이 준 키 하나로 돈다 — 저장소가 기능을 멈추지 않는다', async () => {
  // entries 를 안 주면 key-store 를 부르는데, 시험에서는 server-only 라 불러지지 않는다.
  // 그 경로가 조용히 한 개짜리 목록으로 떨어지는지를 여기서 센다.
  const used: string[] = []

  const got = await withProviderKeys('gemini', 'only-key', async (apiKey) => { used.push(apiKey); return 'ok' })

  assert.equal(got, 'ok')
  assert.deepEqual(used, ['only-key'])
})

test('★ 자기 형으로 분류하는 호출처는 그 판정을 그대로 쓴다 — 문구로 되돌려 추측하게 하지 않는다', async () => {
  // 전사는 429 를 한글 안내문으로 바꿔 던진다. 문구에는 429 도 quota 도 없다
  // 매개변수 속성(constructor(readonly x))은 strip-only 모드가 못 읽는다 — 칸을 따로 적는다
  class SttLike extends Error {
    kind: string
    constructor(kind: string) { super('음성 인식 사용량 한도에 걸렸습니다.'); this.kind = kind }
  }
  const used: string[] = []

  assert.equal(keyOutcomeOf(new SttLike('quota')), 'transient', '문구만 보면 못 잡는다')

  await withProviderKeys('groq', 'k1', async (apiKey) => {
    used.push(apiKey)
    if (apiKey === 'k1') throw new SttLike('quota')
    return 1
  }, {
    entries: [keyEntry('첫째', 'k1'), keyEntry('둘째', 'k2')],
    outcomeOf: (e) => (e instanceof SttLike && (e.kind === 'quota' || e.kind === 'auth') ? e.kind : 'transient'),
  })

  assert.deepEqual(used, ['k1', 'k2'])
})

test('★ 갈아타기 직전에만 알린다 — 갈 곳이 없는데 간다고 말하지 않는다', async () => {
  const told: string[] = []
  const entries = [keyEntry('첫째', 'k1'), keyEntry('둘째', 'k2')]
  const deps = { entries, onSwitch: (from: KeyPoolEntry, to: KeyPoolEntry) => { told.push(`${from.label}->${to.label}`) } }

  // 첫 키만 막히면 한 번 알린다
  await withProviderKeys('gemini', 'k1', async (apiKey) => {
    if (apiKey === 'k1') throw QUOTA()
    return 1
  }, deps)
  assert.deepEqual(told, ['첫째->둘째'])

  // 전부 막히면 마지막 키에서는 알리지 않는다 — 갈 곳이 없다
  told.length = 0
  await assert.rejects(() => withProviderKeys('gemini', 'k1', async () => { throw QUOTA() }, deps))
  assert.deepEqual(told, ['첫째->둘째'], '마지막 키 실패까지 갈아탄다고 말하면 안 된다')
})

/* ── 옆길이 실제로 그 부품을 타는가 ────────────────────────────
   부품이 맞아도 부르는 자리가 없으면 아무 일도 안 일어난다.
   («테이블·설정만 만들고 소비 코드 0» — 이 저장소가 v0.7.438 에서 겪은 그 상태다) */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openAiCompatibleStt, SttError } from '../stt/provider.ts'
import type { AiLedger } from './guarded-call.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string): string => readFileSync(join(WEB, rel), 'utf8')

/** 원장은 시도마다 남아야 한다 — 429 를 맞았어도 녹음은 이미 그 업체로 나갔다 */
function fakeLedger(): { ledger: AiLedger; calls: number } {
  const state = { ledger: null as unknown as AiLedger, calls: 0 }
  state.ledger = {
    recordCall: async () => { state.calls += 1 },
    recordTransfer: async () => {},
  }
  return state as { ledger: AiLedger; calls: number }
}

const realFetch = globalThis.fetch

const VERBOSE_JSON = {
  segments: [{ start: 0, end: 1, text: '안녕하세요' }],
  text: '안녕하세요',
}

test('★ 회의 녹음 전사가 Groq 키 여러 개를 순서대로 시도한다', async () => {
  const seenKeys: string[] = []
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const auth = String((init.headers as Record<string, string>).Authorization)
    seenKeys.push(auth.replace('Bearer ', ''))
    if (seenKeys.length === 1) {
      return { ok: false, status: 429, text: async () => 'rate limited', json: async () => ({}) }
    }
    return { ok: true, status: 200, json: async () => VERBOSE_JSON, text: async () => '' }
  }) as unknown as typeof fetch

  try {
    const lg = fakeLedger()
    const stt = openAiCompatibleStt({
      vendor: 'groq', endpoint: 'https://example.test/v1/audio/transcriptions',
      apiKey: 'k1', model: 'whisper-large', ledger: lg.ledger,
      keys: { entries: [keyEntry('첫째', 'k1'), keyEntry('둘째', 'k2')] },
    })

    const out = await stt.transcribe({
      bytes: new Uint8Array([1, 2, 3]).buffer, mimeType: 'audio/webm', filename: 'a.webm',
    })

    assert.equal(out.segments.length, 1)
    assert.deepEqual(seenKeys, ['k1', 'k2'], '첫 키가 한도면 다음 키로 같은 녹음을 보내야 한다')
    assert.equal(lg.calls, 2, '원장은 시도마다 남는다 — 429 를 맞았어도 녹음은 이미 나갔다')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('★ 키가 하나면 전사는 한 번만 나간다 — 회귀 없음', async () => {
  let n = 0
  globalThis.fetch = (async () => {
    n += 1
    return { ok: false, status: 429, text: async () => '', json: async () => ({}) }
  }) as unknown as typeof fetch

  try {
    const stt = openAiCompatibleStt({
      vendor: 'groq', endpoint: 'https://example.test/v1', apiKey: 'k1',
      model: 'whisper-large', ledger: fakeLedger().ledger,
      keys: { entries: [keyEntry('하나', 'k1')] },
    })

    await assert.rejects(
      () => stt.transcribe({ bytes: new Uint8Array([1]).buffer, mimeType: 'audio/webm', filename: 'a.webm' }),
      (e: unknown) => e instanceof SttError && e.reason === 'quota',
    )
    assert.equal(n, 1)
  } finally {
    globalThis.fetch = realFetch
  }
})

/*
  임베딩은 `@/lib/...` 별칭으로 import 해서 node 시험이 그 모듈을 못 불러온다.
  그래서 여기서는 **배선만** 센다 — 교체 규칙 자체는 위에서 실행으로 이미 쟀다.
  (계산으로 대체한 자리이고, 무엇을 대체했는지 밝혀 둔다)
*/
test('★ 임베딩이 키 교체 부품을 탄다 — 홑 건과 묶음 둘 다', () => {
  const src = read('lib/gemini-embedding.ts')
  assert.equal(src.split('withProviderKeys(').length - 1, 2,
    '홑 건(embedText)과 묶음(embedTexts) 둘 다 타야 한다 — 묶음이 빠지면 대량 색인이 첫 키만 두드린다')
  // 한도·인증을 null 로 덮으면 「키가 마름」과 「임베딩 못 만듦」이 같은 값이 되고
  // 등록된 다음 키는 한 번도 안 쓰인다. 두 자리 모두에서 던져야 한다
  assert.equal(src.split('res.status === 429').length - 1, 2)
  for (const m of src.matchAll(/res\.status === 429[\s\S]{0,140}/g)) {
    assert.match(m[0], /throw new Error/, '한도를 null 로 덮는 자리가 남아 있다')
  }
})

test('★ CI 수집과 GPU 추출은 키를 자기 방식으로 또 읽지 않는다 — 공통 호출기를 탄다', () => {
  for (const rel of ['lib/ci/ai/meta.ts', 'lib/gpu/extract-helpers.ts']) {
    const src = read(rel)
    assert.ok(!src.includes('ai_provider_keys'), `${rel} 가 키 표를 직접 연다`)
    assert.ok(!src.includes('withProviderKeys'),
      `${rel} 가 자기 키 교체를 갖고 있다 — gemini-call 이 이미 한다`)
  }
  // 그 «이미 한다»가 사실인지도 같이 센다. 아니면 위 둘은 아무 데도 안 닿는다
  assert.match(read('lib/ai/gemini-call.ts'), /await import\('\.\/key-store\.ts'\)/,
    '공통 호출기가 표를 안 보면 CI·GPU 는 여전히 키 하나로 돈다')
})

/* ── 과부하 (실측 2026-09-23) ──────────────────────────────── */

test('★ 과부하에서도 다음 키로 넘어간다 — 유료 키까지 순서가 돌아간다', async () => {
  const used: string[] = []
  // 화면에 등록돼 있던 그대로. 무료 셋이 앞, 유료가 맨 뒤다
  const entries = [
    keyEntry('기본', 'free1'), keyEntry('pickup ai', 'free2'),
    keyEntry('ai team', 'free3'), keyEntry('유료키', 'paid'),
  ]
  const got = await withProviderKeys('gemini', 'free1', async (key) => {
    used.push(key)
    if (key !== 'paid') throw OVERLOAD()
    return '읽었다'
  }, { entries })

  assert.equal(got, '읽었다')
  assert.deepEqual(used, ['free1', 'free2', 'free3', 'paid'],
    '무료 셋이 전부 붐벼도 유료 키를 부른다. 여기서 멈추면 사고가 그대로 재현된다')
})

test('★ 과부하는 그 키를 한도로 적지 않는다 — 한도와 처방이 다르다', async () => {
  const noted: Array<{ label: string; outcome: string }> = []
  const entries = [keyEntry('첫째', 'k1'), keyEntry('둘째', 'k2')]
  await withProviderKeys('gemini', 'k1', async (key) => {
    if (key === 'k1') throw OVERLOAD()
    return 'ok'
  }, {
    entries,
    record: (entry, outcome) => { noted.push({ label: entry.label, outcome }) },
  })

  assert.deepEqual(noted, [{ label: '첫째', outcome: 'overload' }, { label: '둘째', outcome: 'ok' }],
    'quota 로 적으면 key-pool 이 그 키에 점점 긴 벌을 매긴다 (최대 6시간)')
})

test('원인 불명은 여전히 멈춘다 — 과부하를 열었다고 아무 실패나 키를 태우지 않는다', async () => {
  const used: string[] = []
  const entries = [keyEntry('첫째', 'k1'), keyEntry('둘째', 'k2')]
  await assert.rejects(
    withProviderKeys('gemini', 'k1', async (key) => { used.push(key); throw NETWORK() }, { entries }),
  )
  assert.deepEqual(used, ['k1'], '네트워크가 한 번 튄 것으로 남은 키를 소진하지 않는다')
})
