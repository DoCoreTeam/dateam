import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickFrontContract, NO_FRONT_REASON } from './front.ts'

test('덮어쓰기가 있으면 그것이 이긴다', () => {
  const p = pickFrontContract({ override: 'A05611', fromTable: 'A05610' })
  assert.deepEqual(p, { code: 'A05611', source: 'override', reason: null })
})

test('덮어쓰기가 비어 있으면 월물 표를 본다 — 이것이 안 되어 검증이 영영 안 돌았다', () => {
  // 실측 2026-09-30: front_contract_code_override 가 "" 였고 표에는 A05610 이 있었다.
  // 그때 검증 크론은 표를 안 보고 no_contract 로 끝났다
  for (const empty of ['', '   ', null, undefined]) {
    const p = pickFrontContract({ override: empty, fromTable: 'A05610' })
    assert.deepEqual(p, { code: 'A05610', source: 'table', reason: null }, `덮어쓰기 ${String(empty)}`)
  }
})

test('둘 다 없으면 없다고 말하고 무엇을 하면 되는지 적는다', () => {
  const p = pickFrontContract({ override: '', fromTable: null })
  assert.equal(p.code, null)
  assert.equal(p.source, 'none')
  assert.equal(p.reason, NO_FRONT_REASON)
  assert.match(p.reason ?? '', /수집/, '무엇을 하면 되는지를 안 적는다')
})

test('앞뒤 공백은 떼고 쓴다 — 설정에 공백만 넣은 것을 값으로 읽지 않는다', () => {
  assert.equal(pickFrontContract({ override: '  A05611  ', fromTable: null }).code, 'A05611')
  assert.equal(pickFrontContract({ override: null, fromTable: '  A05610 ' }).code, 'A05610')
})
