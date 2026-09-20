// lib/ai/key-pool.test.ts — 고르는 규칙이 실제로 그렇게 고르는가
//
// 이 규칙이 틀리면 증상이 조용하다. 키를 세 개 넣어 뒀는데 계속 첫 키만 두드리거나,
// 반대로 멀쩡한 키를 건너뛰고 「전부 막혔다」고 말한다. 둘 다 화면에서는
// 그냥 「AI 가 안 된다」로 보인다. 그래서 순서 자체를 센다.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  orderKeys,
  orderForView,
  nextKeyState,
  applyKeyState,
  isCooling,
  isBlocked,
  maskApiKey,
  QUOTA_COOLDOWN_MS,
  QUOTA_COOLDOWN_MAX_MS,
  TRANSIENT_COOLDOWN_MS,
  type KeyPoolEntry,
} from './key-pool.ts'

const NOW = Date.parse('2026-09-20T12:00:00.000Z')

function entry(over: Partial<KeyPoolEntry> & { id: string }): KeyPoolEntry {
  return {
    provider: 'gemini',
    label: over.id,
    apiKey: `AIza-${over.id}-0123456789`,
    priority: 0,
    isPaid: false,
    isActive: true,
    cooldownUntil: null,
    disabledReason: null,
    consecutiveFailures: 0,
    ...over,
  }
}

test('가운데 키가 쿨다운이면 빠지고 나머지 둘이 순서대로 나온다', () => {
  const rows = [
    entry({ id: 'a', priority: 0 }),
    entry({ id: 'b', priority: 1, cooldownUntil: new Date(NOW + 60_000).toISOString(), disabledReason: 'quota' }),
    entry({ id: 'c', priority: 2 }),
  ]

  const order = orderKeys(rows, NOW).map((k) => k.id)

  assert.deepEqual(order, ['a', 'c'])
})

test('우선순위 낮은 것부터 나온다 (저장 순서가 아니라 priority 가 정한다)', () => {
  const rows = [
    entry({ id: 'later', priority: 5 }),
    entry({ id: 'first', priority: 0 }),
    entry({ id: 'mid', priority: 2 }),
  ]

  assert.deepEqual(orderKeys(rows, NOW).map((k) => k.id), ['first', 'mid', 'later'])
})

test('전부 쿨다운이면 빈 목록이 아니라 가장 빨리 풀리는 키 하나를 준다', () => {
  const rows = [
    entry({ id: 'late', priority: 0, cooldownUntil: new Date(NOW + 3_600_000).toISOString(), disabledReason: 'quota' }),
    entry({ id: 'soon', priority: 9, cooldownUntil: new Date(NOW + 60_000).toISOString(), disabledReason: 'quota' }),
  ]

  const order = orderKeys(rows, NOW)

  assert.equal(order.length, 1, '빈 목록을 주면 부르는 쪽이 「키가 없다」와 구별하지 못한다')
  assert.equal(order[0].id, 'soon')
})

test('사람이 끈 키와 인증이 깨진 키는 마지막 수단으로도 안 쓴다', () => {
  const rows = [
    entry({ id: 'off', isActive: false }),
    entry({ id: 'badauth', disabledReason: 'auth' }),
  ]

  assert.deepEqual(orderKeys(rows, NOW), [], '기다려도 안 풀리는 키를 두드리면 폴백만 느려진다')
})

test('쿨다운이 지난 키는 다시 후보가 된다', () => {
  const rows = [entry({ id: 'a', cooldownUntil: new Date(NOW - 1).toISOString(), disabledReason: 'quota' })]

  assert.deepEqual(orderKeys(rows, NOW).map((k) => k.id), ['a'])
})

test('키가 하나도 없으면 빈 목록이다', () => {
  assert.deepEqual(orderKeys([], NOW), [])
})

test('429 를 받은 키의 쿨다운 해제 시각은 지금보다 뒤다', () => {
  const row = entry({ id: 'a' })

  const patch = nextKeyState(row, 'quota', NOW, '429 Too Many Requests')

  assert.ok(patch.cooldownUntil, '쿨다운 시각이 있어야 한다')
  assert.ok(Date.parse(patch.cooldownUntil) > NOW, '지금보다 뒤여야 한다')
  assert.equal(Date.parse(patch.cooldownUntil), NOW + QUOTA_COOLDOWN_MS)
  assert.equal(patch.disabledReason, 'quota')
  assert.equal(patch.consecutiveFailures, 1)
  assert.equal(patch.isActive, true, '한도는 기다리면 풀린다 — 끄지 않는다')
})

test('연속으로 막히면 쉬는 시간이 길어지고 상한에서 멈춘다', () => {
  const first = nextKeyState(entry({ id: 'a', consecutiveFailures: 1 }), 'quota', NOW)
  const second = nextKeyState(entry({ id: 'a', consecutiveFailures: 2 }), 'quota', NOW)
  const far = nextKeyState(entry({ id: 'a', consecutiveFailures: 30 }), 'quota', NOW)

  assert.equal(Date.parse(first.cooldownUntil) - NOW, QUOTA_COOLDOWN_MS * 2)
  assert.equal(Date.parse(second.cooldownUntil) - NOW, QUOTA_COOLDOWN_MS * 4)
  assert.equal(Date.parse(far.cooldownUntil) - NOW, QUOTA_COOLDOWN_MAX_MS, '무한정 늘지 않는다')
})

test('401 을 받은 키는 쿨다운이 아니라 사용 중지가 된다', () => {
  const patch = nextKeyState(entry({ id: 'a' }), 'auth', NOW, '401 Unauthorized')

  assert.equal(patch.cooldownUntil, null, '기다려서 풀릴 일이 아니다')
  assert.equal(patch.disabledReason, 'auth')
  assert.equal(patch.isActive, false, '사람이 키를 고치기 전에는 다시 켜지 않는다')
})

test('성공은 쿨다운과 연속 실패 기억을 지운다', () => {
  const row = entry({
    id: 'a',
    cooldownUntil: new Date(NOW + 60_000).toISOString(),
    disabledReason: 'quota',
    consecutiveFailures: 4,
  })

  const patch = nextKeyState(row, 'ok', NOW)

  assert.equal(patch.cooldownUntil, null)
  assert.equal(patch.disabledReason, null)
  assert.equal(patch.consecutiveFailures, 0)
  assert.equal(patch.lastError, null)
})

test('원인 불명 실패는 짧게만 쉰다', () => {
  const patch = nextKeyState(entry({ id: 'a' }), 'transient', NOW, '네트워크 오류')

  assert.equal(Date.parse(patch.cooldownUntil) - NOW, TRANSIENT_COOLDOWN_MS)
  assert.equal(patch.disabledReason, null, '원인을 모르면 한도라고 적지 않는다')
  assert.equal(patch.isActive, true)
})

test('오류 문구는 잘라서 남긴다 (공급자 원문에 키 조각이 섞여 온다)', () => {
  const patch = nextKeyState(entry({ id: 'a' }), 'quota', NOW, 'x'.repeat(500))

  assert.equal(patch.lastError.length, 200)
})

test('패치를 얹어도 원본 줄은 그대로다', () => {
  const row = entry({ id: 'a' })
  const patched = applyKeyState(row, nextKeyState(row, 'quota', NOW))

  assert.equal(row.cooldownUntil, null, '원본이 바뀌면 부르는 쪽이 두 값을 구별 못 한다')
  assert.ok(patched.cooldownUntil)
  assert.equal(patched.apiKey, row.apiKey)
})

test('쿨다운 판정과 차단 판정은 서로 다른 질문이다', () => {
  const cooling = entry({ id: 'a', cooldownUntil: new Date(NOW + 1).toISOString(), disabledReason: 'quota' })
  const blocked = entry({ id: 'b', disabledReason: 'auth' })

  assert.equal(isCooling(cooling, NOW), true)
  assert.equal(isBlocked(cooling), false, '한도는 기다리면 풀린다')
  assert.equal(isCooling(blocked, NOW), false)
  assert.equal(isBlocked(blocked), true)
})

test('망가진 시각 문자열은 쿨다운 없음으로 읽는다 (표 값 하나로 키가 영영 안 쓰이면 안 된다)', () => {
  const row = entry({ id: 'a', cooldownUntil: '어제' })

  assert.equal(isCooling(row, NOW), false)
  assert.deepEqual(orderKeys([row], NOW).map((k) => k.id), ['a'])
})

test('가림값에 키 원문이 남지 않는다', () => {
  const key = 'AIzaSyD-1234567890abcdefghij'

  const masked = maskApiKey(key)

  assert.equal(masked, 'AIza****ghij')
  assert.ok(!masked.includes('1234567890'), '가운데가 남으면 가린 것이 아니다')
  assert.equal(maskApiKey('short'), '****', '짧은 키는 길이조차 알려 주지 않는다')
})

/* ── 유료 키 (마이그 269) ─────────────────────────────────────────
   무료 키를 다 태우고 나서 결제되는 키를 부른다. 이 규칙이 틀리면 증상이 안 보인다 —
   화면은 그대로 돌고 청구서만 는다. 그래서 순서 자체를 센다. */

test('★ 쓸 수 있는 무료 키가 있으면 유료 키는 앞에 오지 않는다', () => {
  // priority 로는 유료가 먼저다. 등급이 그것을 이겨야 한다
  const rows = [
    entry({ id: 'paid', priority: 0, isPaid: true }),
    entry({ id: 'free', priority: 9 }),
  ]

  assert.deepEqual(orderKeys(rows, NOW).map((k) => k.id), ['free', 'paid'])
})

test('★ 무료 키가 전부 쉬는 중이면 유료 키가 나온다 — 그러라고 있는 키다', () => {
  const rows = [
    entry({ id: 'free-a', priority: 0, cooldownUntil: new Date(NOW + 60_000).toISOString(), disabledReason: 'quota' }),
    entry({ id: 'free-b', priority: 1, cooldownUntil: new Date(NOW + 60_000).toISOString(), disabledReason: 'quota' }),
    entry({ id: 'paid', priority: 2, isPaid: true }),
  ]

  assert.deepEqual(orderKeys(rows, NOW).map((k) => k.id), ['paid'])
})

test('★ 무료 키가 꺼져 있거나 인증이 깨졌어도 유료로 넘어간다', () => {
  const rows = [
    entry({ id: 'free-off', priority: 0, isActive: false }),
    entry({ id: 'free-broken', priority: 1, disabledReason: 'auth' }),
    entry({ id: 'paid', priority: 2, isPaid: true }),
  ]

  assert.deepEqual(orderKeys(rows, NOW).map((k) => k.id), ['paid'])
})

test('같은 등급 안에서는 priority 가 그대로 순서를 정한다', () => {
  const rows = [
    entry({ id: 'paid-late', priority: 1, isPaid: true }),
    entry({ id: 'free-late', priority: 1 }),
    entry({ id: 'paid-early', priority: 0, isPaid: true }),
    entry({ id: 'free-early', priority: 0 }),
  ]

  assert.deepEqual(orderKeys(rows, NOW).map((k) => k.id),
    ['free-early', 'free-late', 'paid-early', 'paid-late'])
})

test('전부 쉬는 중이면 등급보다 빨리 풀리는 쪽이 이긴다 — 아낄 무료 키가 애초에 없다', () => {
  const rows = [
    entry({ id: 'free', priority: 0, cooldownUntil: new Date(NOW + 600_000).toISOString(), disabledReason: 'quota' }),
    entry({ id: 'paid', priority: 1, isPaid: true, cooldownUntil: new Date(NOW + 60_000).toISOString(), disabledReason: 'quota' }),
  ]

  assert.deepEqual(orderKeys(rows, NOW).map((k) => k.id), ['paid'])
})

test('★ 보이는 순서와 고르는 순서가 같은 규칙을 쓴다 — 다르면 화면의 「앞에 있는 키부터」가 거짓말이 된다', () => {
  const rows = [
    entry({ id: 'paid', priority: 0, isPaid: true }),
    entry({ id: 'free-cooling', priority: 1, cooldownUntil: new Date(NOW + 60_000).toISOString(), disabledReason: 'quota' }),
    entry({ id: 'free-ready', priority: 2 }),
  ]

  // 보는 목록은 못 쓰는 줄도 남긴다. 그래도 **순서**는 고르는 목록과 어긋나지 않는다
  const view = orderForView(rows).map((k) => k.id)
  assert.deepEqual(view, ['free-cooling', 'free-ready', 'paid'])

  const picked = orderKeys(rows, NOW).map((k) => k.id)
  assert.deepEqual(picked, ['free-ready', 'paid'])
  // 고르는 목록은 보는 목록의 부분수열이다 (빠지기만 하고 앞뒤가 바뀌지 않는다)
  assert.deepEqual(picked, view.filter((id) => picked.includes(id)))
})
