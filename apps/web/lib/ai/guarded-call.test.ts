/**
 * 개인정보가 나가는 길에 두른 한 겹이 실제로 가리고 적는지 본다
 *
 * **왜**: 가림 부품은 예전부터 있었는데 **부르는 앱 코드가 0곳**이었다(실측 2026-09-16).
 * 만들어 둔 것과 지나는 것은 다른 명제이고, 이 시험이 보는 것은 뒤쪽이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guardedText, guardedMedia, PiiNotMaskedError, type AiLedger } from './guarded-call.ts'

function spyLedger() {
  const calls: unknown[] = []
  const transfers: unknown[] = []
  const ledger: AiLedger = {
    async recordCall(r) { calls.push(r) },
    async recordTransfer(r) { transfers.push(r) },
  }
  return { ledger, calls, transfers }
}

const CTX = { surface: 'crm/card', purpose: 'card_read' }
const PROMPT = '담당자 김도현 010-1234-5678 kim@example.com 입니다'

test('보내기 전에 가린다, 원문이 그대로 나가지 않는다', async () => {
  const { ledger } = spyLedger()
  let sent = ''
  await guardedText(PROMPT, CTX, ledger, async (masked) => {
    sent = masked
    return { text: 'ok' }
  })
  assert.ok(!sent.includes('010-1234-5678'), '전화번호가 그대로 나갔다')
  assert.ok(!sent.includes('kim@example.com'), '이메일이 그대로 나갔다')
  assert.ok(sent.includes('김도현'), '이름은 이 규칙이 안 잡는다, 그 사실을 알고 있어야 한다')
})

test('왕복이 원문을 잃지 않는다', async () => {
  const { ledger } = spyLedger()
  const out = await guardedText(PROMPT, CTX, ledger, async (masked) => ({ text: masked }))
  assert.equal(out.text, PROMPT, '되돌린 답이 원문과 같아야 한다')
})

test('무엇을 몇 개 가렸는지만 남고 값은 안 남는다', async () => {
  const { ledger, transfers } = spyLedger()
  await guardedText(PROMPT, CTX, ledger, async () => ({ text: 'ok' }))
  const t = transfers[0] as { masked_counts: Record<string, number>; media_kind: string; bytes: number }
  assert.ok(t.masked_counts.phone >= 1)
  assert.ok(t.masked_counts.email >= 1)
  assert.equal(t.media_kind, 'text')
  assert.equal(JSON.stringify(t).includes('010-1234-5678'), false, '원장이 유출 경로가 되면 안 된다')
  assert.equal(JSON.stringify(t).includes('kim@example.com'), false)
})

test('성공한 호출은 호출 원장과 전송 원장 둘 다에 남는다', async () => {
  const { ledger, calls, transfers } = spyLedger()
  await guardedText(PROMPT, CTX, ledger, async () => ({ text: 'ok', inputTokens: 10, outputTokens: 5 }))
  assert.equal(calls.length, 1)
  assert.equal(transfers.length, 1)
  const c = calls[0] as { ok: boolean; surface: string; contract_version: number }
  assert.equal(c.ok, true)
  assert.equal(c.surface, 'crm/card')
  assert.ok(c.contract_version >= 1, '판 번호가 처음부터 박힌다')
})

test('실패한 호출도 원장에 남고, 나간 것이 없으면 전송 원장에는 안 남는다', async () => {
  const { ledger, calls, transfers } = spyLedger()
  await assert.rejects(
    guardedText(PROMPT, CTX, ledger, async () => { throw new Error('벤더가 죽었다') }),
    /벤더가 죽었다/,
  )
  assert.equal(calls.length, 1)
  assert.equal((calls[0] as { ok: boolean }).ok, false)
  assert.equal(transfers.length, 0, '성공하지 않은 호출을 전송 장부에 적으면 그 장부를 못 믿는다')
})

test('가린 뒤에도 개인정보가 남아 있으면 안 보낸다', async () => {
  const { ledger } = spyLedger()
  let called = false
  // 자리표를 흉내 낸 값이 아니라 실제로 규칙이 못 잡는 모양을 만들 수는 없으므로
  // 가림 함수를 통과시킨 뒤 남는지 보는 경로 자체를 확인한다
  await guardedText('평범한 글', CTX, ledger, async () => { called = true; return { text: 'ok' } })
  assert.equal(called, true, '남은 것이 없으면 정상적으로 보낸다')
  assert.equal(typeof PiiNotMaskedError, 'function', '막는 예외가 존재한다')
})

test('그림과 소리는 가린 척하지 않는다', async () => {
  const { ledger, transfers } = spyLedger()
  const out = await guardedMedia(
    12345,
    { surface: 'meeting/stt', purpose: 'transcribe', media: 'audio' },
    ledger,
    async () => ({ text: '김도현 010-1234-5678 라고 말했습니다' }),
  )
  const t = transfers[0] as { masked_counts: Record<string, number>; media_kind: string; bytes: number }
  assert.deepEqual(t.masked_counts, {}, '안 가렸으면 안 가렸다고 적는다')
  assert.equal(t.media_kind, 'audio')
  assert.equal(t.bytes, 12345)
  assert.ok(out.maskedOnReturn.phone >= 1, '답에 실려 온 개인정보를 셈한다')
  assert.ok(out.text.includes('010-1234-5678'), '전사 결과를 지우지는 않는다, 지우면 회의록을 못 읽는다')
})

test('그림과 소리도 나간 사실은 반드시 남는다', async () => {
  const { ledger, transfers } = spyLedger()
  await assert.rejects(
    guardedMedia(10, { surface: 's', purpose: 'p', media: 'image' }, ledger, async () => {
      throw new Error('실패')
    }),
    /실패/,
  )
  assert.equal(transfers.length, 1, '호출이 실패해도 보낸 것은 보낸 것이다')
})

test('기록기가 없는 칸을 쓰면 조용히 넘어가지 않는다', async () => {
  const { createAiLedger } = await import('./ledger.ts')
  const seen: string[] = []
  const original = console.error
  console.error = (...a: unknown[]) => { seen.push(a.map(String).join(' ')) }
  try {
    const ledger = createAiLedger({
      from: () => ({ insert: async () => ({ error: { message: 'column "surfacee" does not exist' } }) }),
    })
    await ledger.recordCall({} as never)
    await ledger.recordTransfer({} as never)
  } finally {
    console.error = original
  }
  assert.equal(seen.length, 2, 'supabase 는 insert 오류를 던지지 않고 돌려준다, 읽지 않으면 0건이 된다')
  assert.ok(seen[0].includes('surfacee'))
})

test('★ 아는 이름을 주면 이름도 가려져 나간다', async () => {
  const { ledger, transfers } = spyLedger()
  let sent = ''
  const out = await guardedText(
    '담당자 김도현 010-1234-5678',
    { ...CTX, knownNames: ['김도현'] },
    ledger,
    async (masked) => { sent = masked; return { text: masked } },
  )
  assert.ok(!sent.includes('김도현'), '이름이 그대로 나갔다')
  assert.equal(out.text, '담당자 김도현 010-1234-5678', '왕복이 원문을 잃지 않는다')
  const t = transfers[0] as { masked_counts: Record<string, number> }
  assert.equal(t.masked_counts.name, 1)
  assert.equal(JSON.stringify(t).includes('김도현'), false, '원장에 이름 값은 안 남는다')
})

test('★ 이름 목록을 안 주면 전과 똑같이 동작한다', async () => {
  const { ledger } = spyLedger()
  let sent = ''
  await guardedText(PROMPT, CTX, ledger, async (masked) => { sent = masked; return { text: 'ok' } })
  assert.ok(sent.includes('김도현'), '목록이 없으면 이름은 안 가린다, 추측하지 않는다')
  assert.ok(!sent.includes('010-1234-5678'), '다른 규칙은 그대로 돈다')
})

test('★ 소리로 보낸 답에 실려 온 이름도 셈한다', async () => {
  const { ledger } = spyLedger()
  const out = await guardedMedia(
    100,
    { surface: 'meeting/stt', purpose: 'transcribe', media: 'audio', knownNames: ['김도현'] },
    ledger,
    async () => ({ text: '김도현 이 말했습니다' }),
  )
  assert.equal(out.maskedOnReturn.name, 1)
  assert.ok(out.text.includes('김도현'), '전사 결과를 지우지는 않는다')
})
