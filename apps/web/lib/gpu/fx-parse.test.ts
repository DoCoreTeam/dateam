import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCurUnit, parseDealBas, parseKoraeximRows } from './fx-parse.ts'

test('parseCurUnit — JPY(100) 100단위 인식', () => {
  assert.deepEqual(parseCurUnit('JPY(100)'), { code: 'JPY', per_unit: 100 })
  assert.deepEqual(parseCurUnit('USD'), { code: 'USD', per_unit: 1 })
  assert.deepEqual(parseCurUnit('IDR(100)'), { code: 'IDR', per_unit: 100 })
})
test('parseCurUnit — CNH는 CNY로 정규화', () => {
  assert.deepEqual(parseCurUnit('CNH'), { code: 'CNY', per_unit: 1 })
})
test('parseCurUnit — 잡토큰은 null', () => {
  assert.equal(parseCurUnit('위안'), null)
  assert.equal(parseCurUnit(''), null)
})
test('parseDealBas — 콤마 문자열 파싱', () => {
  assert.equal(parseDealBas('1,342.5'), 1342.5)
  assert.equal(parseDealBas('950.12'), 950.12)
  assert.equal(parseDealBas('-'), null)
})
test('parseKoraeximRows — JPY 100단위 → krw_per_1 정규화(100배 사고 방지)', () => {
  const rows = [
    { result: 1, cur_unit: 'USD', deal_bas_r: '1,342.5' },
    { result: 1, cur_unit: 'JPY(100)', deal_bas_r: '950.0' }, // 100엔=950원 → 1엔=9.5원
    { result: 1, cur_unit: 'CNH', deal_bas_r: '188.3' },
  ]
  const parsed = parseKoraeximRows(rows)
  const jpy = parsed.find((p) => p.currency === 'JPY')!
  assert.equal(jpy.per_unit, 100)
  assert.equal(jpy.deal_bas_krw, 950)
  assert.equal(jpy.krw_per_1, 9.5) // 950 / 100 — 여기가 100배 사고 방지 지점
  const usd = parsed.find((p) => p.currency === 'USD')!
  assert.equal(usd.krw_per_1, 1342.5)
  assert.ok(parsed.some((p) => p.currency === 'CNY')) // CNH→CNY
})
test('parseKoraeximRows — result!=1 행·비배열 방어', () => {
  assert.deepEqual(parseKoraeximRows(null), [])
  assert.deepEqual(parseKoraeximRows([{ result: 2, cur_unit: 'USD', deal_bas_r: '1300' }]), [])
})
