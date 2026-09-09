import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_TABLE_CHARS, HWP_WARNING } from './hwp.ts'
import { guessFileRole } from './role.ts'

test('★ 나라장터 첨부 「공고서(…)」 를 공고로 알아본다 — 실측에서 etc 로 떨어졌다', () => {
  const r = guessFileRole('공고서(국가SW,_일반,_20억미만,_서면,_차등)콜롬비아_AI_기반_디지털정부.hwpx')
  assert.equal(r.role, 'notice')
})

test('제안요청서는 본문이다', () => {
  assert.equal(guessFileRole('제안요청서_콜롬비아_AI_기반_디지털정부.hwpx').role, 'main')
})

test('정정공고가 본문보다 먼저다 — 「제안요청서(정정)」은 정정공고다', () => {
  assert.equal(guessFileRole('제안요청서(정정)_어떤사업.hwp').role, 'amendment')
})

test('큰 표를 문서 틀로 보는 기준이 있다 — 진짜 데이터 표는 이 크기를 안 넘는다', () => {
  // 실측: 133KB 공고서가 26,796자 표 한 덩이가 됐다
  assert.ok(MAX_TABLE_CHARS > 0 && MAX_TABLE_CHARS < 26_796)
  assert.ok(HWP_WARNING.layoutTableSplit.length > 0)
})
