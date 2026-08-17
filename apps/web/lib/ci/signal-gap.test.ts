// lib/ci/signal-gap.test.ts — 세는 조건과 훑는 조건이 다시 갈리지 않게 잠근다
//
// 이 가드가 지키는 사고: 카드는 "1건 남았습니다"라고 세고 버튼은 "하나도 남지 않았어요"라고
// 답했다. 두 쿼리가 조건을 따로 적었기 때문이다. 조건이 갈리면 그 화면은 눌러도 영원히 안 변한다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { whereMissingSignals, whereRefillable, REFILLABLE_PLATFORMS } from './signal-gap.ts'

interface Call { op: string; column: string; value: unknown }

/** supabase 빌더 흉내 — 어떤 조건이 걸렸는지만 기록한다 */
function fake() {
  const calls: Call[] = []
  const q = {
    calls,
    eq(column: string, value: unknown) { calls.push({ op: 'eq', column, value }); return q },
    is(column: string, value: unknown) { calls.push({ op: 'is', column, value }); return q },
    in(column: string, value: readonly unknown[]) { calls.push({ op: 'in', column, value: [...value] }); return q },
  }
  return q
}

const same = (a: Call, b: Call) =>
  a.op === b.op && a.column === b.column && JSON.stringify(a.value) === JSON.stringify(b.value)

test('★ 훑는 조건은 세는 조건을 그대로 포함한다 — 갈리면 화면이 영원히 안 변한다', () => {
  const counted = whereMissingSignals(fake()).calls
  const scanned = whereRefillable(fake()).calls
  for (const c of counted) {
    assert.ok(
      scanned.some((s) => same(s, c)),
      `세는 조건 ${c.op}(${c.column})이 훑는 조건에 없다 — 세어지지만 절대 채워지지 않는 게시물이 생긴다`,
    )
  }
})

test('"신호 없음"의 정의는 카테고리도 신호도 없는 것이다', () => {
  const calls = whereMissingSignals(fake()).calls
  assert.ok(calls.some((c) => c.op === 'eq' && c.column === 'topic_signals' && c.value === '{}'))
  assert.ok(calls.some((c) => c.op === 'is' && c.column === 'platform_category' && c.value === null))
})

test('다시 받아올 수 있는 것은 커넥터가 있는 플랫폼뿐이다', () => {
  const platform = whereRefillable(fake()).calls.find((c) => c.column === 'platform')
  assert.equal(platform?.op, 'in')
  assert.deepEqual(platform?.value, [...REFILLABLE_PLATFORMS])
})

test('커넥터 목록은 여기 한 곳에만 있다 — 늘리려면 이 상수를 고친다', () => {
  // 지금 신호를 되받아올 수 있는 커넥터는 유튜브뿐이다(lib/ci/connectors/youtube.ts).
  // 다른 플랫폼 커넥터가 생기면 이 단정이 먼저 깨져서, 화면 문구도 함께 손보게 된다.
  assert.deepEqual([...REFILLABLE_PLATFORMS], ['youtube'])
})
