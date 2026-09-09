// lib/crm/domain/derived.test.ts — 못 내면 「아직 모름」이지 0 이 아니다
//
// 목표가 없는데 달성률 0% 를 그리면 사람은 그걸 「하나도 못 했다」로 읽는다.
// 근거가 없는 것과 성적이 나쁜 것은 다른 사실이다 — 이 가드가 그 둘을 가른다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { computeDerived, computeAllDerived, elapsedRatio } from './derived.ts'
import { DERIVED } from './metrics.ts'

const 억 = (n: number) => String(n * 100_000_000)

const input = (over: Partial<Parameters<typeof computeDerived>[1]> = {}) => ({
  values: { bookings: 억(24), weighted: 억(14), open_pipeline: 억(38), won_count: '3', lost_count: '1' },
  target: 억(100),
  elapsed: 0.5,
  ...over,
})

test('★ 목표가 없으면 달성률을 내지 않고, 무엇이 없는지 말한다', () => {
  const r = computeDerived('attainment', input({ target: null }))!
  assert.equal(r.value, null, '0% 는 「하나도 못 했다」로 읽힌다')
  assert.deepEqual(r.missing, ['target'])
})

test('목표가 있으면 달성률을 낸다 — 24억 / 100억 = 24%', () => {
  assert.equal(computeDerived('attainment', input())!.value, 24)
})

test('★ 부족분 = 목표 − 수주 − 가중 예상', () => {
  assert.equal(computeDerived('shortfall', input())!.value, 억(62))
})

test('★ 목표를 넘겼으면 부족분은 0 이다 — 음수를 「부족분 -3억」으로 그리면 뜻이 뒤집힌다', () => {
  const r = computeDerived('shortfall', input({ target: 억(10) }))!
  assert.equal(r.value, '0')
})

test('★ 끝난 딜이 0건이면 승률을 내지 않는다 — 0% 는 「다 실패했다」로 읽힌다', () => {
  const r = computeDerived('win_rate', input({ values: { ...input().values, won_count: '0', lost_count: '0' } }))!
  assert.equal(r.value, null)
  assert.ok(r.missing[0].includes('끝난 딜'))
})

test('승률은 성사 ÷ (성사+실패) — 3/4 = 75%', () => {
  assert.equal(computeDerived('win_rate', input())!.value, 75)
})

test('파이프라인 배수 = 열린 파이프라인 ÷ 남은 목표 — 38 / 76 = 0.5배', () => {
  assert.equal(computeDerived('coverage', input())!.value, 0.5)
})

test('★ 목표를 이미 넘겼으면 배수를 내지 않는다 — 0으로 나누지 않는다', () => {
  const r = computeDerived('coverage', input({ target: 억(10) }))!
  assert.equal(r.value, null)
  assert.ok(r.missing[0].includes('넘겼'))
})

test('필요 신규 = 부족분 ÷ 승률 — 62억 / 0.75 = 82.66억', () => {
  const r = computeDerived('needed_new', input())!
  assert.equal(r.value, '8266666666')
})

test('★ 성사한 딜이 없으면 필요 신규를 내지 않는다 — 0으로 나누지 않는다', () => {
  const v = { ...input().values, won_count: '0', lost_count: '2' }
  const r = computeDerived('needed_new', input({ values: v }))!
  assert.equal(r.value, null)
})

test('페이스 = 달성률 ÷ 기간 경과율 — 24% / 50% = 0.48', () => {
  assert.equal(computeDerived('pace', input())!.value, 0.48)
})

test('★ 기간이 아직 시작 안 됐으면 페이스를 내지 않는다', () => {
  assert.equal(computeDerived('pace', input({ elapsed: 0 }))!.value, null)
})

test('경과율은 양끝에서 0 과 1 이다 — 시계를 읽지 않는다', () => {
  assert.equal(elapsedRatio('2026-01-01', '2026-12-31', '2025-12-31'), 0)
  assert.equal(elapsedRatio('2026-01-01', '2026-12-31', '2027-01-01'), 1)
  assert.ok(Math.abs(elapsedRatio('2026-01-01', '2026-12-31', '2026-07-02') - 0.5) < 0.01)
  assert.equal(elapsedRatio('2026-12-31', '2026-01-01', '2026-06-01'), 0, '거꾸로 된 기간에 터지지 않는다')
})

test('★ 재료가 없으면 값 대신 무엇이 없는지 준다 — 전부', () => {
  const all = computeAllDerived({ values: {}, target: null })
  assert.equal(all.length, DERIVED.length)
  for (const d of all) {
    assert.equal(d.value, null, `${d.key} 가 근거 없이 숫자를 냈다`)
    assert.ok(d.missing.length > 0, `${d.key} 가 왜 못 내는지 말하지 않는다`)
  }
})

test('모르는 파생 지표는 null — 지어내지 않는다', () => {
  assert.equal(computeDerived('없는것', input()), null)
})

test('깨진 값에 터지지 않는다 — 숫자가 아니면 못 내는 것으로 본다', () => {
  const r = computeDerived('attainment', input({ target: '십억' }))!
  assert.equal(r.value, null)
})

test('파생 계산은 순수하다 — DB 도 시계도 모른다', () => {
  const src = readFileSync(new URL('./derived.ts', import.meta.url), 'utf8')
  for (const banned of ['@prisma/client', 'findMany', 'new Date()', 'Date.now']) {
    assert.ok(!src.includes(banned), `파생 계산이 ${banned} 를 안다`)
  }
})

/**
 * 회귀 — **페이스는 배수다.**
 *
 * 「1보다 작으면 이 속도로는 목표에 못 닿는다」가 뜻인데 단위가 `%` 면 0.04 가
 * 「0.04%」로 읽혀 뜻이 뒤집힌다. 실브라우저에서 잡았다(v0.7.711).
 */
test('페이스의 단위는 배수다 — 퍼센트가 아니다', () => {
  const d = computeDerived('pace', {
    values: { bookings: '24260000' }, target: '1000000000', elapsed: 0.69,
  })
  assert.equal(d?.unit, 'times', '퍼센트로 그리면 0.04 가 「0.04%」가 된다')
})

test('달성률과 배수는 단위가 서로 다르다 — 한 벌로 묶지 않는다', () => {
  const inp = { values: { bookings: '5', open_pipeline: '10' }, target: '10' }
  assert.equal(computeDerived('attainment', inp)?.unit, 'percent')
  assert.equal(computeDerived('coverage', inp)?.unit, 'times')
})
