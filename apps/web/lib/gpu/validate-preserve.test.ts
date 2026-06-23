import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateCompetitorItem, partitionValid } from './validate.ts'

// 보존 보정(T3): 가격없는 행을 block→price_unknown(warn)으로 완화 — 기존 동작은 옵션 없을 때 유지.

test('기본(옵션 없음) — 가격 없으면 block 유지(기존 호환)', () => {
  const r = validateCompetitorItem({ competitor_name: 'Nebius', model_name: 'GB200' })
  assert.equal(r.ok, false)
  assert.equal(r.priceUnknown ?? false, false)
  assert.ok(r.issues.some((i) => i.field === 'price_usd' && i.severity === 'block'))
})

test('preserveNoPrice — 가격 없으면 block 아님 + priceUnknown 플래그', () => {
  const r = validateCompetitorItem({ competitor_name: 'Nebius', model_name: 'GB200' }, { preserveNoPrice: true })
  assert.equal(r.ok, true)
  assert.equal(r.priceUnknown, true)
  assert.ok(r.issues.some((i) => i.field === 'price_usd' && i.severity === 'warn'))
  assert.ok(!r.issues.some((i) => i.severity === 'block'))
})

test('preserveNoPrice — 모델명 필수 규칙은 유지(완화 대상은 "가격 없음"만)', () => {
  const r = validateCompetitorItem({ competitor_name: 'Nebius' }, { preserveNoPrice: true })
  assert.equal(r.ok, false)
  assert.ok(r.issues.some((i) => i.field === 'model_name' && i.severity === 'block'))
})

test('preserveNoPrice — 가격 있으면 범위(>0) 검증은 그대로(불가능치 차단)', () => {
  const ok = validateCompetitorItem({ competitor_name: 'X', model_name: 'H100', price_usd: 2.5 }, { preserveNoPrice: true })
  assert.equal(ok.ok, true)
  assert.equal(ok.priceUnknown ?? false, false)
  const bad = validateCompetitorItem({ competitor_name: 'X', model_name: 'H100', price_usd: 0 }, { preserveNoPrice: true })
  assert.equal(bad.ok, false) // 가격 0은 여전히 block(불가능치)
})

test('partitionValid — preserveNoPrice 시 가격미상 행이 passed에 포함', () => {
  const items = [
    { competitor_name: 'Nebius', model_name: 'HGX B300', price_usd: 4.3 },  // ok
    { competitor_name: 'Nebius', model_name: 'GB300' },                      // 가격미상 → 보존시 passed
    { competitor_name: 'Nebius' },                                           // 모델명 없음 → block
  ]
  const { passed, blocked } = partitionValid(items, (it) => validateCompetitorItem(it, { preserveNoPrice: true }))
  assert.equal(passed.length, 2)
  assert.equal(blocked.length, 1)
})
