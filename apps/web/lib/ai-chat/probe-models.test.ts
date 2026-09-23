/**
 * 모델 훑기가 **키가 죽은 것**과 **모델이 죽은 것**을 가르는가 (실행으로 잰다)
 *
 * ## 왜 이 파일이 생겼나 (실측 2026-09-21)
 *
 * 크레딧이 마른 키 하나로 훑으면 `probeModelIds` 가 계정 실패를 잡아 남은 모델을 전부 같은
 * 결과로 채운다. 그 값이 `ai_model_catalog` 에 `unavailable` 로 굳고 `buildModelChain` 이
 * 그걸 읽어 멀쩡한 모델을 후보에서 뺀다. **키 하나가 마른 일이 공급자 전체를 죽은 것으로
 * 적어 두는 것이다.** 등록된 키가 셋 더 있는데도 그랬다.
 *
 * ## 한 겹 더 (실측 2026-09-23)
 *
 * 계정 실패만 갈아타는 것으로는 모자랐다. 무료 키에서 `gemini-2.5-flash` 가 404
 * 「no longer available to **new users**」였는데, 이건 **모델 단위 실패로 분류되면서도
 * 실제로는 그 키(프로젝트)의 사정**이었다. 같은 순간 유료 키로는 200 이었다.
 * 그래서 이제 키 하나에 물어보고 끝내지 않는다 — **전부에게 묻고 되는 쪽을 남긴다.**
 *
 * 여기서 재는 것 — 하나라도 되는 키가 있으면 available 인가, 아무도 못 하면 사유가 남는가,
 * 유료 키를 먼저 찌르는가, 결판난 모델을 다음 키로 또 넘기지 않는가, 키 판정이 옳은가.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { probeModelIdsAcrossKeys } from './probe-models.ts'
import { classifyModelProbeFailure } from './probe-result.ts'
import type { ChatProvider, ProbeModelResult } from './provider.ts'
import type { KeyPoolEntry } from '../ai/key-pool.ts'

/* ── 준비물 ─────────────────────────────────────── */

function entry(id: string, apiKey: string, isPaid = false): KeyPoolEntry {
  return {
    id, provider: 'openai', label: id, apiKey,
    priority: 0, isPaid, isActive: true,
    cooldownUntil: null, disabledReason: null, consecutiveFailures: 0,
  }
}

/** 키마다 다른 답을 주는 가짜 공급자. 어느 키로 몇 번 찔렀는지 적어 둔다 */
function fakeProvider(answer: (apiKey: string, modelId: string) => ProbeModelResult) {
  const calls: string[] = []
  const provider = {
    id: 'openai',
    label: 'OpenAI',
    async probeModel(apiKey: string, modelId: string): Promise<ProbeModelResult> {
      calls.push(`${apiKey}:${modelId}`)
      return answer(apiKey, modelId)
    },
  } as unknown as ChatProvider
  return { calls, provider }
}

const MODELS = ['m1', 'm2']
const OK: ProbeModelResult = { usable: true, availability: 'available' }

/* ── 갈래가 서는가 ──────────────────────────────── */

test('★ 크레딧 소진은 quota, 무효 키는 auth — 둘을 같은 말로 하면 키가 잘못 꺼진다', () => {
  const credit = classifyModelProbeFailure('OpenAI', 429, 'You exceeded your current quota', 'insufficient_quota')
  assert.equal(credit.accountLevel, true)
  assert.equal(credit.keyOutcome, 'quota', '결제가 붙으면 풀리는 일이라 사람을 기다리게 하면 안 된다')

  const bad = classifyModelProbeFailure('OpenAI', 401, 'invalid api key')
  assert.equal(bad.accountLevel, true)
  assert.equal(bad.keyOutcome, 'auth', '기다려도 안 풀린다')
})

test('모델 단위 실패에는 키 판정을 안 붙인다 — 붙이면 멀쩡한 키가 꺼진다', () => {
  for (const r of [
    classifyModelProbeFailure('OpenAI', 404, 'model_not_found'),
    classifyModelProbeFailure('OpenAI', 429, 'rate limit reached'),
    classifyModelProbeFailure('OpenAI', 403, 'your organization must be verified'),
  ]) {
    assert.equal(r.accountLevel, undefined)
    assert.equal(r.keyOutcome, undefined)
  }
})

/* ── 키를 갈아 가며 훑는가 ──────────────────────── */

/** 그 키로는 이 모델이 안 보인다. 404 지만 **모델이 아니라 키의 사정**이다 (실측 원문) */
const NEW_USERS: ProbeModelResult = {
  usable: false, availability: 'unavailable',
  reason: '이 모델은 더 이상 사용할 수 없습니다. 다른 모델을 선택하세요.',
}
const DEAD: ProbeModelResult = {
  usable: false, availability: 'unavailable',
  reason: 'OpenAI 계정의 크레딧이 소진되었거나 결제가 설정되지 않았습니다.',
  accountLevel: true, keyOutcome: 'quota',
}

test('★ 한 키라도 되면 available 이다 — 키 하나의 사정을 모델에 적지 않는다', async () => {
  // 실측 재현: 무료 키는 404, 유료 키는 200
  const fake = fakeProvider((apiKey) => (apiKey === 'PAID' ? OK : NEW_USERS))
  const map = await probeModelIdsAcrossKeys('openai', 'FREE', fake.provider, MODELS, 2, {
    entries: [entry('무료', 'FREE'), entry('유료', 'PAID', true)],
  })
  assert.equal(map.get('m1')?.availability, 'available')
  assert.equal(map.get('m2')?.availability, 'available')
})

test('★ 되는 키가 하나도 없을 때만 unavailable 이고, 사유가 남는다', async () => {
  const fake = fakeProvider(() => NEW_USERS)
  const map = await probeModelIdsAcrossKeys('openai', 'FREE', fake.provider, MODELS, 2, {
    entries: [entry('무료', 'FREE'), entry('유료', 'PAID', true)],
  })
  assert.equal(map.get('m1')?.availability, 'unavailable')
  assert.match(map.get('m1')?.reason ?? '', /사용할 수 없습니다/)
})

test('★ 나중 키의 나쁜 답이 앞 키의 나은 답을 덮지 않는다', async () => {
  /*
    이 갈래가 없으면 병합 규칙이 한 번도 안 깨진다 — available 로 결판난 모델은 다음 키로
    안 넘어가므로 「되는 쪽이 이긴다」가 저절로 지켜지는 것처럼 보인다.
    결판이 안 난 채(limited) 다음 키로 넘어가는 이 자리가 그 규칙이 실제로 일하는 유일한 곳이다.
  */
  const LIMITED: ProbeModelResult = { usable: true, availability: 'limited', reason: '한도에 걸렸습니다.' }
  const fake = fakeProvider((apiKey) => (apiKey === 'PAID' ? LIMITED : NEW_USERS))
  const map = await probeModelIdsAcrossKeys('openai', 'FREE', fake.provider, MODELS, 2, {
    entries: [entry('무료', 'FREE'), entry('유료', 'PAID', true)],
  })
  assert.equal(map.get('m1')?.availability, 'limited',
    'limited 는 기다리면 풀린다. unavailable 로 덮으면 체인이 그 모델을 아예 뺀다')
})

test('★ 유료 키를 먼저 찌른다 — 가장 많이 보는 눈이 앞이라야 헛호출이 준다', async () => {
  const fake = fakeProvider((apiKey) => (apiKey === 'PAID' ? OK : NEW_USERS))
  await probeModelIdsAcrossKeys('openai', 'FREE', fake.provider, MODELS, 1, {
    entries: [entry('무료', 'FREE'), entry('유료', 'PAID', true)],
  })
  assert.deepEqual(fake.calls, ['PAID:m1', 'PAID:m2'],
    '유료가 전부 답했으므로 무료 키는 한 번도 안 찔린다')
})

test('★ 결판난 모델은 다음 키로 안 넘긴다 — 아직 모르는 것만 다시 묻는다', async () => {
  // m1 은 아무 키로나 되고, m2 는 유료로만 된다. 유료가 앞이므로 둘 다 첫 바퀴에 끝난다
  const fake = fakeProvider((apiKey, modelId) =>
    (modelId === 'm1' || apiKey === 'PAID' ? OK : NEW_USERS))
  await probeModelIdsAcrossKeys('openai', 'FREE', fake.provider, MODELS, 1, {
    entries: [entry('유료', 'PAID', true), entry('무료', 'FREE')],
  })
  assert.deepEqual(fake.calls, ['PAID:m1', 'PAID:m2'])
})

test('★ 계정 실패는 그 키에 적고, 모델 실패로는 키를 안 태운다', async () => {
  const noted: Array<{ label: string; outcome: string }> = []
  const record = (e: KeyPoolEntry, outcome: string) => { noted.push({ label: e.label, outcome }) }

  const dead = fakeProvider((apiKey) => (apiKey === 'PAID' ? OK : DEAD))
  await probeModelIdsAcrossKeys('openai', 'FREE', dead.provider, MODELS, 2, {
    entries: [entry('무료', 'FREE'), entry('유료', 'PAID', true)],
    record: record as never,
  })
  assert.deepEqual(noted, [{ label: '유료', outcome: 'ok' }],
    '유료가 전부 답해 무료 키는 안 불렸다. 안 부른 키를 벌줄 수는 없다')

  noted.length = 0
  const gone = fakeProvider(() => NEW_USERS)
  await probeModelIdsAcrossKeys('openai', 'FREE', gone.provider, MODELS, 2, {
    entries: [entry('무료', 'FREE'), entry('유료', 'PAID', true)],
    record: record as never,
  })
  assert.deepEqual(noted.map((n) => n.outcome), ['ok', 'ok'],
    '모델이 없어진 것으로 키를 재우면 정작 한도가 찼을 때 쓸 키가 없다')
})

test('★ 첫 키가 계정 실패면 다음 키가 그 자리를 메운다', async () => {
  const noted: string[] = []
  const fake = fakeProvider((apiKey) => (apiKey === 'B' ? OK : DEAD))
  const map = await probeModelIdsAcrossKeys('openai', 'A', fake.provider, MODELS, 2, {
    entries: [entry('첫째', 'A'), entry('둘째', 'B')],
    record: ((e: KeyPoolEntry, outcome: string) => { noted.push(`${e.label}:${outcome}`) }) as never,
  })
  assert.equal(map.get('m1')?.availability, 'available')
  assert.deepEqual(noted, ['첫째:quota', '둘째:ok'])
})

test('키가 전부 계정 실패면 마지막 표를 그대로 준다 — 결제하라는 사실조차 못 적으면 안 된다', async () => {
  const fake = fakeProvider(() => DEAD)
  const map = await probeModelIdsAcrossKeys('openai', 'A', fake.provider, MODELS, 2, {
    entries: [entry('첫째', 'A'), entry('둘째', 'B')],
  })
  assert.equal(map.get('m1')?.availability, 'unavailable')
  assert.match(map.get('m1')?.reason ?? '', /크레딧/)
})

test('키가 하나면 정확히 한 바퀴만 돈다 — 교체가 헛호출을 늘리지 않는다', async () => {
  const fake = fakeProvider(() => OK)
  await probeModelIdsAcrossKeys('openai', 'A', fake.provider, MODELS, 2, {
    entries: [entry('첫째', 'A')],
  })
  assert.deepEqual(fake.calls.sort(), ['A:m1', 'A:m2'])
})

test('가용 상태를 확인할 줄 모르는 공급자는 그대로 지나간다 — 없는 능력으로 키를 태우지 않는다', async () => {
  const provider = { id: 'groq', label: 'Groq' } as unknown as ChatProvider
  const map = await probeModelIdsAcrossKeys('groq', 'A', provider, MODELS, 2, {
    entries: [entry('첫째', 'A')],
  })
  assert.equal(map.get('m1')?.availability, 'unknown')
})
