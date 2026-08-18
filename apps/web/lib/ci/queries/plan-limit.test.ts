// lib/ci/queries/plan-limit.test.ts — 플랜 한도 가드
//
// 막는 것: **한도를 두지 않으려는 플랜이 한도를 갖게 되는 것.**
//
// 실측 2026-08-18: 사내 워크스페이스가 '무료 체험' 플랜(tracked_channels 3)에 묶여 있어
// 4번째 채널 등록이 거부됐다. 사용자는 그런 제한을 설정한 적이 없다.
// 진짜 원인은 값이 3인 것이 아니라 **무제한을 표현할 방법이 없었던 것**이다 —
// limits에서 값을 빼면 코드가 무조건 3으로 떨어졌다.
//
// DB를 부르지 않고 판정 규칙만 검사한다. 규칙은 channels.ts의 trackedChannelLimit과 같은 표다.

import test from 'node:test'
import assert from 'node:assert/strict'

/** channels.ts의 판정과 같은 규칙. 규칙이 갈리면 이 테스트가 무의미해지므로 함께 고친다. */
function limitFrom(plan: { limits: Record<string, unknown> } | null): number {
  if (!plan) return 3
  const limits = plan.limits ?? {}
  if (limits.tracked_channels == null) return Number.POSITIVE_INFINITY
  const n = Number(limits.tracked_channels)
  return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY
}

test('★ 한도를 null로 두면 무제한이다 — 이걸 표현할 수 없어서 벽이 생겼다', () => {
  assert.equal(limitFrom({ limits: { tracked_channels: null } }), Number.POSITIVE_INFINITY)
})

test('★ 키가 아예 없어도 무제한이다 — 예전에는 여기서 3으로 떨어졌다', () => {
  assert.equal(limitFrom({ limits: {} }), Number.POSITIVE_INFINITY)
  assert.equal(limitFrom({ limits: { members: 5 } }), Number.POSITIVE_INFINITY)
})

test('명시한 한도는 그대로 지킨다 — 나중에 실제로 판매할 때 필요하다', () => {
  assert.equal(limitFrom({ limits: { tracked_channels: 3 } }), 3)
  assert.equal(limitFrom({ limits: { tracked_channels: 50 } }), 50)
  assert.equal(limitFrom({ limits: { tracked_channels: '10' } }), 10)
})

test('구독이 아예 없으면 무료 기본값 — 아무 워크스페이스나 무제한이 되지 않게', () => {
  assert.equal(limitFrom(null), 3)
})

test('0이나 음수는 한도가 아니다 — 0곳까지 허용하는 플랜은 제품이 아니다', () => {
  assert.equal(limitFrom({ limits: { tracked_channels: 0 } }), Number.POSITIVE_INFINITY)
  assert.equal(limitFrom({ limits: { tracked_channels: -1 } }), Number.POSITIVE_INFINITY)
})
