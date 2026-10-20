import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseItem, parseRules, parseConditions } from './pricebook-input.ts'
import { jsonSafe } from './json-safe.ts'

test('품목: 금액은 문자열 정수, 쉼표를 걷는다', () => {
  const it = parseItem({ name: ' GPU 라이선스 ', listPriceMinor: '7,300,000', basis: 'PER_UNIT', unit: '장' })
  assert.equal(it.name, 'GPU 라이선스')
  assert.equal(it.listPriceMinor, BigInt(7_300_000))
})

test('품목: 음수, 소수, 문자 금액은 막는다', () => {
  for (const bad of ['-1', '1.5', 'abc']) {
    assert.throws(() => parseItem({ name: 'x', listPriceMinor: bad }))
  }
})

test('품목: 비율은 0~100, 비율 품목은 정상가를 안 받는다', () => {
  assert.throws(() => parseItem({ name: 'x', basis: 'RATIO', ratioPct: 120 }))
  assert.throws(() => parseItem({ name: 'x', basis: 'RATIO' }))
  const r = parseItem({ name: '유지보수', basis: 'RATIO', ratioPct: 15, ratioOfSection: '라이선스', listPriceMinor: '999' })
  assert.equal(r.listPriceMinor, null)
  assert.equal(r.ratioPct, 15)
})

test('규칙: 모르는 종류는 막는다, 종류만 맞으면 본문은 저장 때 검사', () => {
  assert.throws(() => parseRules([{ kind: 'FORMULA' }]))
  assert.equal(parseRules([{ kind: 'CAP', item: 'a', varKey: 'nodes', max: 1 }]).length, 1)
})

test('조건: 모르는 기관 종류는 null, 할인은 숫자 또는 auto none', () => {
  const c = parseConditions({ picked: ['a', 3], gpus: [{ model: 'H100', count: '4' }, { model: '' }], companyKind: 'hacker', discount: 200 })!
  assert.deepEqual(c.picked, ['a'])
  assert.equal(c.gpus.length, 1)
  assert.equal(c.gpus[0].count, 4)
  assert.equal(c.companyKind, null)
  assert.equal(c.discount, 'auto')
})

test('jsonSafe: 깊은 bigint 와 날짜를 문자열로', () => {
  const v = jsonSafe({ a: BigInt(1), b: [{ c: BigInt(2) }], d: new Date('2026-01-01T00:00:00Z') }) as Record<string, unknown>
  assert.equal(JSON.stringify(v), '{"a":"1","b":[{"c":"2"}],"d":"2026-01-01T00:00:00.000Z"}')
})

test('조건이 이미 산 품목과 근거를 받는다 — 화면이 미리 켠 체크', () => {
  const c = parseConditions({ picked: ['edge-ent'], owned: ['edge-std', 3], ownedNote: ' 2025-03-14 체결 ' })
  assert.deepEqual(c?.owned, ['edge-std'])
  assert.equal(c?.ownedNote, '2025-03-14 체결')
  assert.equal(parseConditions({ picked: [] })?.owned, undefined)
})
