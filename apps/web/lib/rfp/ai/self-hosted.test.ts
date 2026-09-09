/**
 * 사내 서빙과 리랭커·임베딩 교체 가드 (설계서 3.6.3)
 *
 * 여기서 잠그는 것 넷
 * - 주소·키·모델명 셋만으로 등록되는가
 * - 등록 전에는 후보에서 빠지는가 (없는데 있다고 하면 사용자가 기다린다)
 * - 사내 모델의 기본 등급이 셋 다이고 전송 기록에 internal 로 남는가
 * - 리랭커와 임베딩을 같은 방식으로 바꿔 끼울 수 있는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  checkEndpoint, isPrivateHost, toInternalModel, usableInternalModels, createSelfHostedCaller,
  INTERNAL_DEFAULT_DOC_CLASSES, type SelfHostedEndpoint,
} from './self-hosted.ts'
import {
  pickProvider, internalProvider, rerank, embedWith, type AiProvider,
} from './rerank.ts'
import { callWithFallback, type GatewayStore, type LlmCallRecord, type TransferRecord, type CallRequest } from './gateway.ts'
import { pickModels, type AiModel } from './models.ts'

const 엔드포인트: SelfHostedEndpoint = {
  baseUrl: 'http://10.0.0.5:8000', apiKey: 'sk-내부', modelName: 'qwen3-32b',
}

function 가짜장부() {
  const calls: LlmCallRecord[] = []
  const transfers: TransferRecord[] = []
  const store: GatewayStore = {
    async recordCall(r) { calls.push(r) },
    async recordTransfer(r) { transfers.push(r) },
  }
  return { store, calls, transfers }
}

// 등록

test('주소와 키와 모델명 셋이면 등록된다', () => {
  const r = checkEndpoint(엔드포인트)
  assert.equal(r.ok, true)
  assert.equal(r.ok === true && r.endpoint.modelName, 'qwen3-32b')
})

test('주소 끝 슬래시를 정리하고 빈 키는 null 로 둔다', () => {
  const r = checkEndpoint({ baseUrl: 'https://gpu.example.com/v1/', apiKey: '  ', modelName: 'm' })
  assert.equal(r.ok === true && r.endpoint.baseUrl, 'https://gpu.example.com/v1')
  assert.equal(r.ok === true && r.endpoint.apiKey, null)
})

test('빠진 값을 사유로 알려 준다', () => {
  const r = checkEndpoint({})
  assert.equal(r.ok, false)
  assert.deepEqual(r.ok === false && r.problems.sort(), ['missing_base_url', 'missing_model_name'])
})

test('사내망 http 는 허용하고 공인 도메인 http 는 막는다', () => {
  // 사내 서버는 대개 TLS 가 없다. 그러나 공인 도메인 http 는 사내망이 아니라 평문 인터넷이다
  assert.equal(checkEndpoint({ baseUrl: 'http://192.168.0.10:8000', modelName: 'm' }).ok, true)
  assert.equal(checkEndpoint({ baseUrl: 'http://localhost:8000', modelName: 'm' }).ok, true)
  const 밖 = checkEndpoint({ baseUrl: 'http://gpu.example.com', modelName: 'm' })
  assert.equal(밖.ok, false)
  assert.deepEqual(밖.ok === false && 밖.problems, ['insecure_url'])
})

test('사내망 판정이 사설 대역을 안다', () => {
  for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.1', 'gpu.internal']) {
    assert.equal(isPrivateHost(h), true, `${h} 를 사내망으로 안 봤다`)
  }
  for (const h of ['gpu.example.com', '8.8.8.8', '172.32.0.1']) {
    assert.equal(isPrivateHost(h), false, `${h} 를 사내망으로 봤다`)
  }
})

test('주소가 주소 모양이 아니면 막는다', () => {
  assert.equal(checkEndpoint({ baseUrl: '그냥 글자', modelName: 'm' }).ok, false)
  assert.equal(checkEndpoint({ baseUrl: 'ftp://x/y', modelName: 'm' }).ok, false)
})

// 등급

test('사내 모델의 기본 등급이 셋 다이다', () => {
  // 사내 서빙은 등급 제한의 대상이 아니라 등급 제한의 해답이다
  assert.deepEqual(Array.from(INTERNAL_DEFAULT_DOC_CLASSES), ['public', 'restricted', 'nda'])
  const m = toInternalModel('m1', 'v-int', 엔드포인트)
  assert.deepEqual(m.allowedDocClasses, ['public', 'restricted', 'nda'])
  assert.equal(m.internal, true)
  assert.equal(m.retention.zeroRetention, true)
})

test('사내 모델은 사슬 앞에 선다', () => {
  const 사내 = toInternalModel('int', 'v-int', 엔드포인트)
  const 외부: AiModel = { ...사내, id: 'ext', internal: false, sortOrder: 10, allowedDocClasses: ['public'] }
  const pick = pickModels([외부, 사내], { docClass: 'public' })
  // 등급이 높은 문서일수록 사내밖에 길이 없다
  assert.deepEqual(pick.chain.map((m) => m.id), ['int', 'ext'])
})

test('NDA 문서를 사내 모델로 부르면 전송 기록에 internal 로 남는다', async () => {
  const { store, calls, transfers } = 가짜장부()
  const req: CallRequest = { orgId: 'o1', caseId: 'c1', docClass: 'nda', purpose: 'analyze', prompt: '본문' }

  const r = await callWithFallback([toInternalModel('int', 'v-int', 엔드포인트)], req, {
    store, call: async () => ({ text: '답', inputTokens: 10, outputTokens: 5 }),
  })

  assert.equal(r.meta.internal, true)
  // 사내는 외부 전송이 아니므로 전송 장부에는 안 남고, 호출 장부에는 남는다
  assert.deepEqual(transfers, [])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].ok, true)
})

// 등록 전 제외

test('등록 안 된 내부 벤더는 후보에서 빠진다', () => {
  const 사내 = toInternalModel('int', 'v-int', 엔드포인트)
  const 외부: AiModel = { ...사내, id: 'ext', vendorId: 'v-ext', internal: false }

  const 없음 = usableInternalModels([사내, 외부], new Map([['v-int', null]]))
  // 「사내 모델이 있다」고 하고 사용자가 기다리는 것보다 없다고 말하는 편이 낫다
  assert.deepEqual(없음.map((m) => m.id), ['ext'])

  const 있음 = usableInternalModels([사내, 외부], new Map([['v-int', 엔드포인트]]))
  assert.deepEqual(있음.map((m) => m.id), ['int', 'ext'])
})

test('주소가 잘못 등록돼 있으면 그것도 빠진다', () => {
  const 사내 = toInternalModel('int', 'v-int', 엔드포인트)
  const 잘못 = usableInternalModels([사내], new Map([['v-int', { baseUrl: '', apiKey: null, modelName: '' }]]))
  assert.deepEqual(잘못, [])
})

// 호출

test('OpenAI 호환 모양으로 부른다', async () => {
  let 받은주소 = ''
  let 받은본문: Record<string, unknown> = {}
  let 받은헤더: Record<string, string> = {}
  const call = createSelfHostedCaller(new Map([['v-int', 엔드포인트]]), (async (url, init) => {
    받은주소 = String(url)
    받은본문 = JSON.parse(String((init as RequestInit).body))
    받은헤더 = (init as RequestInit).headers as Record<string, string>
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: '답' } }], usage: { prompt_tokens: 7, completion_tokens: 3 } }
      },
    } as unknown as Response
  }) as typeof fetch)

  const out = await call(toInternalModel('int', 'v-int', 엔드포인트), '질문',
    { orgId: 'o', caseId: null, docClass: 'nda', purpose: 'p', prompt: '질문' })

  assert.equal(받은주소, 'http://10.0.0.5:8000/v1/chat/completions')
  assert.equal(받은본문.model, 'qwen3-32b')
  assert.equal(받은헤더.authorization, 'Bearer sk-내부')
  assert.equal(out.text, '답')
  assert.equal(out.inputTokens, 7)
})

test('키가 없으면 헤더를 안 붙인다', async () => {
  let 받은헤더: Record<string, string> = {}
  const ep = { ...엔드포인트, apiKey: null }
  const call = createSelfHostedCaller(new Map([['v-int', ep]]), (async (_u, init) => {
    받은헤더 = (init as RequestInit).headers as Record<string, string>
    return { ok: true, async json() { return { choices: [{ message: { content: 'x' } }] } } } as unknown as Response
  }) as typeof fetch)
  await call(toInternalModel('int', 'v-int', ep), 'q', { orgId: 'o', caseId: null, docClass: 'nda', purpose: 'p', prompt: 'q' })
  assert.equal('authorization' in 받은헤더, false)
})

test('빈 응답을 성공으로 넘기지 않는다', async () => {
  const call = createSelfHostedCaller(new Map([['v-int', 엔드포인트]]), (async () =>
    ({ ok: true, async json() { return { choices: [] } } } as unknown as Response)) as typeof fetch)
  await assert.rejects(
    () => call(toInternalModel('int', 'v-int', 엔드포인트), 'q', { orgId: 'o', caseId: null, docClass: 'nda', purpose: 'p', prompt: 'q' }),
    /빈 응답/,
  )
})

// 리랭커·임베딩 교체

test('리랭커도 모델과 같은 관문을 쓴다', () => {
  const 상용: AiProvider = {
    id: 'cohere', kind: 'commercial', displayName: 'Cohere', baseUrl: null, modelName: 'rerank-v3',
    allowedDocClasses: ['public'],
    retention: { noTraining: false, retentionDays: 30, zeroRetention: false },
    enabled: true, sortOrder: 1,
  }
  const 사내 = internalProvider({ id: 'bge', modelName: 'bge-reranker', baseUrl: 'http://10.0.0.5:9000' })

  // 모델만 막고 리랭커를 열어 두면 그 길로 원문이 나간다
  assert.equal(pickProvider([상용, 사내], 'public')?.id, 'cohere')
  assert.equal(pickProvider([상용, 사내], 'nda')?.id, 'bge')
  assert.equal(pickProvider([상용], 'nda'), null)
})

test('등록 안 된 사내 제공자는 후보가 아니다', () => {
  const 미등록 = internalProvider({ id: 'bge', modelName: 'bge', baseUrl: null })
  assert.equal(pickProvider([미등록], 'nda'), null)
})

test('리랭커가 순서를 바꾸고 쓴 사실을 남긴다', async () => {
  const p = internalProvider({ id: 'bge', modelName: 'bge', baseUrl: 'http://10.0.0.5:9000' })
  const r = await rerank('질문', [{ key: 'a', text: 'ㄱ' }, { key: 'b', text: 'ㄴ' }], p,
    async () => [{ key: 'b', score: 0.9 }, { key: 'a', score: 0.1 }])
  assert.deepEqual(r.order, ['b', 'a'])
  assert.equal(r.reranked, true)
  assert.equal(r.providerId, 'bge')
})

test('리랭커가 빠뜨린 후보를 버리지 않는다', async () => {
  const p = internalProvider({ id: 'bge', modelName: 'bge', baseUrl: 'http://x.internal' })
  const r = await rerank('q', [{ key: 'a', text: '1' }, { key: 'b', text: '2' }, { key: 'c', text: '3' }], p,
    async () => [{ key: 'c', score: 1 }])
  // 버리면 검색 결과가 조용히 줄어든다
  assert.deepEqual(r.order, ['c', 'a', 'b'])
})

test('리랭커가 죽으면 원래 순서를 쓰되 그 사실을 남긴다', async () => {
  const p = internalProvider({ id: 'bge', modelName: 'bge', baseUrl: 'http://x.internal' })
  const r = await rerank('q', [{ key: 'a', text: '1' }, { key: 'b', text: '2' }], p,
    async () => { throw new Error('503') })
  // 조용히 원래 순서를 쓰면 「켰는데 왜 순서가 그대로냐」를 아무도 못 푼다
  assert.deepEqual(r.order, ['a', 'b'])
  assert.equal(r.reranked, false)
  assert.equal(r.fallbackReason, '503')
})

test('리랭커가 없으면 없다고 남긴다', async () => {
  const r = await rerank('q', [{ key: 'a', text: '1' }], null, null)
  assert.equal(r.fallbackReason, 'no_provider')
  assert.deepEqual(r.order, ['a'])
})

test('임베딩도 같은 방식으로 바꿔 끼운다', async () => {
  const p = internalProvider({ id: 'bge-e', modelName: 'bge-m3', baseUrl: 'http://x.internal' })
  const ok = await embedWith(['가', '나'], p, async (t) => t.map(() => [0.1, 0.2]))
  assert.equal(ok.providerId, 'bge-e')
  assert.equal(ok.vectors.length, 2)

  const 실패 = await embedWith(['가'], p, async () => { throw new Error('타임아웃') })
  // 던지면 청크 저장이 통째로 막히고 키워드 검색까지 죽는다
  assert.deepEqual(실패.vectors, [null])
  assert.equal(실패.fallbackReason, '타임아웃')

  const 없음 = await embedWith(['가'], null, null)
  assert.deepEqual(없음.vectors, [null])
  assert.equal(없음.fallbackReason, 'no_provider')
})
