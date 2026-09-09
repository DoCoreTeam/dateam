/**
 * AI 게이트웨이 가드 (설계서 3.6.2, 3.13.1)
 *
 * 여기서 잠그는 것 넷
 * - 등급이 막으면 예외가 나고 **전송 장부에 안 남는가** (나가지 않은 것을 적으면 장부를 못 믿는다)
 * - 마스킹 왕복이 원문을 잃지 않는가
 * - 호출마다 토큰·비용·지연이 남는가
 * - 폴백이 등급 관문을 매번 다시 통과하는가 (안 그러면 폴백이 곧 유출이다)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  callWithFallback, TransferBlockedError, NoModelAvailableError,
  type GatewayStore, type LlmCallRecord, type TransferRecord, type CallRequest,
} from './gateway.ts'
import { maskPii, unmaskPii, roundTrips, hasUnmaskedPii, countByKind, tokenFor } from './mask.ts'
import { pickModels, costKrw, toModel, type AiModel } from './models.ts'

function 모델(over: Partial<AiModel> = {}): AiModel {
  return {
    id: 'm1', vendorId: 'v1', modelName: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro',
    allowedDocClasses: ['public'], internal: false,
    retention: { noTraining: true, retentionDays: 0, zeroRetention: true },
    inputKrwPerMTok: 1000, outputKrwPerMTok: 4000,
    multimodal: true, enabled: true, sortOrder: 10, ...over,
  }
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

const 요청: CallRequest = {
  orgId: 'o1', caseId: 'c1', docClass: 'public', purpose: 'analyze',
  prompt: '담당자 010-1234-5678 에게 문의',
}

// 마스킹

test('마스킹 왕복이 원문을 잃지 않는다', () => {
  const 원문 = '담당자 김철수 010-1234-5678, a@b.co.kr, 사업자 123-45-67890, 주민 901231-1234567'
  const m = maskPii(원문)
  assert.notEqual(m.text, 원문)
  assert.equal(unmaskPii(m.text, m.hits), 원문)
  assert.ok(roundTrips(원문))
})

test('같은 값이 여러 번 나오면 같은 자리표를 쓴다', () => {
  // 다른 자리표를 주면 모델이 「두 사람」으로 읽는다
  const m = maskPii('a@b.com 과 a@b.com 은 같다')
  assert.equal(m.hits.length, 1)
  assert.equal(m.text.split(m.hits[0].token).length - 1, 2)
})

test('좁은 규칙이 넓은 규칙보다 먼저다', () => {
  const m = maskPii('901231-1234567')
  // 넓은 규칙이 먼저면 주민번호가 계좌번호로 잡힌다
  assert.equal(m.hits[0].kind, 'rrn')
})

test('자리표는 모델이 고치지 않을 모양이다', () => {
  assert.equal(tokenFor(3), '⟦PII_3⟧')
  // 자연어처럼 생기면 요약하면서 슬쩍 고친다
  assert.equal(/[A-Za-z가-힣]/.test(tokenFor(1).replace(/PII/, '')), false)
})

test('모르는 자리표는 지우지 않고 그대로 둔다', () => {
  // 지우면 모델이 지어낸 자리표가 조용히 사라져 「원문에 없던 말」이 자연스럽게 남는다.
  // hits 가 비면 함수가 먼저 돌아가므로 **아는 자리표 하나를 함께** 넣어야 그 길을 지난다
  const 아는것 = maskPii('a@b.com').hits
  assert.equal(
    unmaskPii(`답: ${아는것[0].token} 과 ⟦PII_9⟧ 입니다`, 아는것),
    '답: a@b.com 과 ⟦PII_9⟧ 입니다',
  )
})

test('마스킹 뒤에 남은 개인정보를 잡는다', () => {
  assert.equal(hasUnmaskedPii('010-1234-5678'), true)
  assert.equal(hasUnmaskedPii(maskPii('010-1234-5678').text), false)
})

test('종류별 건수만 남기고 값은 남기지 않는다', () => {
  const m = maskPii('a@b.com 과 c@d.com, 010-1111-2222')
  const counts = countByKind(m.hits)
  assert.equal(counts.email, 2)
  assert.equal(counts.phone, 1)
  assert.equal(JSON.stringify(counts).includes('@'), false)
})

// 등급 관문

test('등급이 막으면 예외가 나고 전송 장부에 안 남는다', async () => {
  const { store, calls, transfers } = 가짜장부()
  const nda = { ...요청, docClass: 'nda' as const }

  await assert.rejects(
    () => callWithFallback([모델()], nda, { store, call: async () => { throw new Error('불려서는 안 된다') } }),
    TransferBlockedError,
  )
  // 나가지 않은 것을 장부에 적으면 그 장부를 믿을 수 없게 된다
  assert.deepEqual(transfers, [])
  assert.deepEqual(calls, [])
})

test('막힌 모델은 아예 부르지 않는다', async () => {
  const { store } = 가짜장부()
  let 불림 = 0
  await assert.rejects(() => callWithFallback(
    [모델({ allowedDocClasses: ['public'] })],
    { ...요청, docClass: 'restricted' },
    { store, call: async () => { 불림++; return { text: '', inputTokens: 0, outputTokens: 0 } } },
  ))
  assert.equal(불림, 0)
})

test('사내 서빙은 등급 제한의 대상이 아니다', async () => {
  const { store, transfers } = 가짜장부()
  const r = await callWithFallback(
    [모델({ internal: true, allowedDocClasses: ['nda'] })],
    { ...요청, docClass: 'nda' },
    { store, call: async () => ({ text: '답', inputTokens: 10, outputTokens: 5 }) },
  )
  assert.equal(r.meta.internal, true)
  // 사내는 외부 전송이 아니므로 전송 장부에 안 남는다
  assert.deepEqual(transfers, [])
})

// 기록

test('호출마다 토큰과 비용과 지연이 남는다', async () => {
  const { store, calls, transfers } = 가짜장부()
  let t = 1000
  const r = await callWithFallback([모델()], 요청, {
    store,
    now: () => (t += 250),
    call: async () => ({ text: '답', inputTokens: 1_000_000, outputTokens: 500_000 }),
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].inputTokens, 1_000_000)
  assert.equal(calls[0].outputTokens, 500_000)
  assert.equal(calls[0].costKrw, 1000 + 2000)
  assert.ok(calls[0].latencyMs > 0)
  assert.equal(calls[0].ok, true)
  assert.equal(calls[0].purpose, 'analyze')
  assert.equal(r.meta.costKrw, 3000)

  // 밖으로 나간 것은 전송 장부에도 남는다
  assert.equal(transfers.length, 1)
  assert.equal(transfers[0].docClass, 'public')
  assert.ok(transfers[0].bytes > 0)
})

test('실패한 호출도 기록에 남는다', async () => {
  const { store, calls, transfers } = 가짜장부()
  await assert.rejects(() => callWithFallback([모델()], 요청, {
    store, call: async () => { throw new Error('429 할당량 초과') },
  }), NoModelAvailableError)

  // 실패를 안 남기면 「왜 느렸나」와 「얼마나 자주 막히나」를 영영 모른다
  assert.equal(calls.length, 1)
  assert.equal(calls[0].ok, false)
  assert.match(calls[0].error ?? '', /429/)
  assert.deepEqual(transfers, [])
})

test('보낸 글에는 개인정보가 없고 받은 답에는 되돌아온다', async () => {
  const { store, transfers } = 가짜장부()
  let 보낸글 = ''
  const r = await callWithFallback([모델()], 요청, {
    store,
    call: async (_m, prompt) => { 보낸글 = prompt; return { text: `연락처는 ${prompt.match(/⟦PII_\d+⟧/)![0]} 입니다`, inputTokens: 1, outputTokens: 1 } },
  })
  assert.equal(보낸글.includes('010-1234-5678'), false)
  assert.match(r.text, /010-1234-5678/)
  assert.equal(transfers[0].maskedCounts.phone, 1)
})

// 폴백

test('장애가 나면 다음 모델로 넘어가고 그 사실이 결과에 남는다', async () => {
  const { store, calls } = 가짜장부()
  const 사슬 = [모델({ id: 'a', sortOrder: 1 }), 모델({ id: 'b', sortOrder: 2 })]
  let n = 0
  const r = await callWithFallback(사슬, 요청, {
    store,
    call: async () => {
      if (n++ === 0) throw new Error('502')
      return { text: '답', inputTokens: 1, outputTokens: 1 }
    },
  })
  assert.equal(r.meta.modelId, 'b')
  // 안 남기면 왜 느렸는지 아무도 모른다
  assert.deepEqual(r.meta.fallbackFrom, ['a'])
  assert.equal(calls.length, 2)
  assert.equal(calls[0].ok, false)
  assert.equal(calls[1].ok, true)
})

test('폴백도 등급 관문을 다시 통과한다', async () => {
  const { store, transfers } = 가짜장부()
  const 사슬 = [
    모델({ id: 'a', allowedDocClasses: ['public', 'restricted'] }),
    모델({ id: 'b', allowedDocClasses: ['public'] }),   // 이 등급으로는 안 된다
  ]
  let 불린모델: string[] = []
  await assert.rejects(() => callWithFallback(사슬, { ...요청, docClass: 'restricted' }, {
    store,
    call: async (m) => { 불린모델.push(m.id); throw new Error('502') },
  }))
  // 폴백이 관문을 건너뛰면 그것이 곧 유출이다
  assert.deepEqual(불린모델, ['a'])
  assert.deepEqual(transfers, [])
})

test('쓸 모델이 하나도 없으면 그렇게 말한다', async () => {
  const { store } = 가짜장부()
  await assert.rejects(
    () => callWithFallback([], 요청, { store, call: async () => ({ text: '', inputTokens: 0, outputTokens: 0 }) }),
    NoModelAvailableError,
  )
})

// 등록부

test('등급이 안 맞는 모델은 사유와 함께 빠진다', () => {
  const pick = pickModels([
    모델({ id: 'a', allowedDocClasses: ['public'] }),
    모델({ id: 'b', allowedDocClasses: ['nda'] }),
    모델({ id: 'c', enabled: false, allowedDocClasses: ['public'] }),
  ], { docClass: 'public' })

  // 「쓸 모델이 없습니다」만 뜨면 관리자가 무엇을 고쳐야 하는지 모른다
  assert.deepEqual(pick.chain.map((m) => m.id), ['a'])
  assert.deepEqual(pick.excluded.map((e) => [e.model.id, e.reason]), [['b', 'doc_class'], ['c', 'disabled']])
})

test('그림을 읽어야 하면 못 읽는 모델은 빠진다', () => {
  const pick = pickModels([모델({ id: 'a', multimodal: false })], { docClass: 'public', needMultimodal: true })
  assert.deepEqual(pick.chain, [])
  assert.equal(pick.excluded[0].reason, 'not_multimodal')
})

test('순서가 작을수록 먼저 시도된다', () => {
  const pick = pickModels([모델({ id: 'b', sortOrder: 9 }), 모델({ id: 'a', sortOrder: 1 })], { docClass: 'public' })
  assert.deepEqual(pick.chain.map((m) => m.id), ['a', 'b'])
})

test('비용은 백만 토큰 요금을 실제 토큰으로 환산한다', () => {
  assert.equal(costKrw(모델(), 500_000, 250_000), 500 + 1000)
  assert.equal(costKrw(모델(), 0, 0), 0)
})

test('DB 행을 우리 모양으로 옮긴다', () => {
  const m = toModel({
    id: 'x', vendor_id: 'v', model_name: 'gpt-5', display_name: 'GPT 5',
    allowed_doc_classes: ['public'], is_internal: false,
    no_training: true, retention_days: 0, zero_retention: true,
    input_krw_per_mtok: 100, output_krw_per_mtok: 400, multimodal: true, sort_order: 3,
  })
  assert.equal(m.modelName, 'gpt-5')
  assert.equal(m.retention.zeroRetention, true)
  assert.equal(m.enabled, true, '칸이 없으면 켜진 것으로 본다')
})
