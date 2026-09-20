/**
 * 임베딩을 묶어서 부른다 (P0030 I13)
 *
 * ## 무엇을 막는가
 *
 * 벤더 한도는 «요청 수»로 센다. 건마다 한 번씩 부르면 조각 수가 곧 요청 수다.
 * 실측 2026-09-20: 분당 110회로 한도 100 을 넘겼고, 넘긴 쪽 대부분이 색인이었다.
 * `Promise.all` 로 끊어 뿌리던 자리도 있었는데, 그것은 «동시에»일 뿐 요청 수는 같다.
 *
 * 여기서 보는 것은 셋이다. 요청이 실제로 한 번인가, 한 건이 비어도 나머지가 사는가,
 * 돌아온 순서가 넣은 순서와 같은가. 마지막 것이 제일 조용히 틀린다 — 자리로 맞춰
 * 쓰는 쪽이 있어서, 밀리면 **남의 글의 벡터가 내 글에 붙는다**.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guardedVectors, setBudgetGateForTest, type AiLedger } from './ai/guarded-call.ts'
import { embedChunks, oneByOne, isValidVector, EMBED_DIM } from './rfp/index/embed.ts'

function spyLedger() {
  const calls: unknown[] = []
  const transfers: unknown[] = []
  const ledger: AiLedger = {
    async recordCall(r) { calls.push(r) },
    async recordTransfer(r) { transfers.push(r) },
  }
  return { ledger, calls, transfers }
}

const CTX = { surface: 'ai-chat', purpose: 'embed_batch', actorId: 'u-1' }
const vec = (seed: number) => Array.from({ length: EMBED_DIM }, () => seed)

test.beforeEach(() => setBudgetGateForTest({ check: async () => ({ allowed: true, remainingToday: 99 }) }))
test.afterEach(() => setBudgetGateForTest(null))

test('★ 여러 건이 요청 한 번으로 나간다', async () => {
  const { ledger } = spyLedger()
  let 요청수 = 0
  const out = await guardedVectors<number[]>(
    ['가', '나', '다'], CTX, ledger,
    async (masked) => {
      요청수 += 1
      return masked.map((_, i) => ({ value: vec(i), tokens: 1 }))
    },
  )
  assert.equal(요청수, 1, `세 건에 요청이 ${요청수}번 나갔다. 묶은 것이 아니라 동시에 보낸 것이다`)
  assert.equal(out.length, 3)
})

test('★ 한 건이 비어도 나머지가 산다', async () => {
  const { ledger, calls } = spyLedger()
  const out = await guardedVectors<number[]>(
    ['가', '나', '다'], CTX, ledger,
    async (masked) => masked.map((_, i) => (i === 1 ? null : { value: vec(i), tokens: 1 })),
  )
  assert.equal(out.length, 3, '길이가 달라지면 자리로 맞춰 쓰는 쪽이 어긋난다')
  assert.equal(out[1], null)
  assert.ok(out[0] && out[2], '한 건 때문에 나머지를 버렸다')
  // 「실패」 한 마디로는 한 건이 빈 것과 전부 빈 것이 같아진다
  assert.equal((calls[0] as { error: string }).error, 'partial:2/3')
})

test('★ 돌아온 순서가 넣은 순서다 — 밀리면 남의 벡터가 내 글에 붙는다', async () => {
  const { ledger } = spyLedger()
  const out = await guardedVectors<number[]>(
    ['첫', '둘', '셋'], CTX, ledger,
    async (masked) => masked.map((t, i) => ({ value: vec(t === '둘' ? 99 : i), tokens: 1 })),
  )
  assert.equal(out[1]?.value[0], 99, '두 번째로 넣은 글의 벡터가 두 번째 자리에 없다')
})

test('★ 묶어도 가림은 건마다 하고 가린 셈은 전부 더해 남는다', async () => {
  const { ledger, transfers } = spyLedger()
  let 보낸것: string[] = []
  await guardedVectors<number[]>(
    ['연락처 010-1111-2222 입니다', '메일 a@example.com 입니다'], CTX, ledger,
    async (masked) => { 보낸것 = masked; return masked.map((_, i) => ({ value: vec(i), tokens: 1 })) },
  )
  assert.ok(!보낸것.join(' ').includes('010-1111-2222'), '전화번호가 그대로 나갔다')
  assert.ok(!보낸것.join(' ').includes('a@example.com'), '이메일이 그대로 나갔다')
  const t = transfers[0] as { masked_counts: Record<string, number> }
  assert.equal(t.masked_counts.phone, 1)
  assert.equal(t.masked_counts.email, 1)
  assert.equal(transfers.length, 1, '한 번 나갔는데 전송 기록이 여러 줄이다')
})

test('★ 빈 목록은 벤더를 안 부른다', async () => {
  const { ledger, calls } = spyLedger()
  let 불렸나 = false
  const out = await guardedVectors<number[]>([], CTX, ledger, async () => { 불렸나 = true; return [] })
  assert.deepEqual(out, [])
  assert.equal(불렸나, false, '보낼 것이 없는데 요청을 한 번 썼다')
  assert.equal(calls.length, 0)
})

test('★ 색인이 묶음 창구를 그대로 쓴다 — 조각 수만큼 부르지 않는다', async () => {
  let 요청수 = 0
  const chunks = Array.from({ length: 20 }, (_, i) => ({
    chunkKey: `k${i}`, text: `조각 ${i}`, ord: i,
  })) as never[]
  const out = await embedChunks(chunks, async (texts) => {
    요청수 += 1
    return texts.map(() => vec(1))
  })
  assert.equal(out.length, 20)
  // EMBED_BATCH=16 이므로 스무 조각은 두 묶음
  assert.equal(요청수, 2, `스무 조각에 요청이 ${요청수}번 나갔다`)
  assert.ok(out.every((c) => isValidVector(c.embedding)))
})

test('★ 한 묶음이 죽어도 앞뒤 묶음은 산다', async () => {
  const chunks = Array.from({ length: 20 }, (_, i) => ({
    chunkKey: `k${i}`, text: `조각 ${i}`, ord: i,
  })) as never[]
  let n = 0
  const out = await embedChunks(chunks, async (texts) => {
    n += 1
    if (n === 1) throw new Error('벤더가 죽었다')
    return texts.map(() => vec(1))
  })
  assert.equal(out.length, 20, '던져서 성공한 것까지 버려졌다')
  assert.equal(out.slice(0, 16).every((c) => c.embedding === null), true)
  assert.ok(out.slice(16).every((c) => isValidVector(c.embedding)), '뒤 묶음이 죽은 앞 묶음에 끌려갔다')
})

test('oneByOne 은 요청 수를 안 줄인다 — 이름이 그 사실을 말한다', async () => {
  let 요청수 = 0
  const batch = oneByOne(async () => { 요청수 += 1; return vec(1) })
  const out = await batch(['가', '나', '다'])
  assert.equal(요청수, 3)
  assert.equal(out.length, 3)
})
