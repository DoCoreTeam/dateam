import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreModel, rankCandidates, decideBinding, type CatalogEntry } from './conformance.ts'

const CATALOG: CatalogEntry[] = [
  { productId: 'p-h200', model: 'H200' },
  { productId: 'p-h100sxm', model: 'H100 SXM' },
  { productId: 'p-h100pcie', model: 'H100 PCIe' },
  { productId: 'p-b200', model: 'B200' },
  { productId: 'p-a100', model: 'A100' },
]

test('scoreModel — 정확 키일치 100(메모리/부호 무관)', () => {
  assert.equal(scoreModel('H200', 'H200'), 100)
  // 핵심: held를 유발하던 'H200 141GB.'가 카탈로그 'H200'과 정확 일치(coreModelKey가 흡수)
  assert.equal(scoreModel('H200 141GB.', 'H200'), 100)
  assert.equal(scoreModel('H100 80GB ', 'H100 SXM') < 100, true) // 폼팩터 다르면 100 아님
})

test('scoreModel — 부분 포함 70, 무관 0', () => {
  assert.equal(scoreModel('H100', 'H100 SXM'), 70) // h100 ⊂ h100sxm
  assert.equal(scoreModel('B200', 'A100'), 0)
})

test('rankCandidates — 점수순 Top-N, 동률 입력순', () => {
  const r = rankCandidates('H100', CATALOG, 3)
  assert.ok(r.length >= 1)
  // 'H100'은 H100 SXM·H100 PCIe에 부분포함(70), 입력순(SXM 먼저)
  assert.equal(r[0].model, 'H100 SXM')
  assert.equal(r[0].score, 70)
})

test('decideBinding — held 대신 auto: H200 141GB.가 카탈로그 H200으로 자동 바인딩', () => {
  const r = decideBinding('H200 141GB.', CATALOG)
  assert.equal(r.decision, 'auto')
  assert.equal(r.productId, 'p-h200')
})

test('decideBinding — 부분유사는 후보 제시(차단 아님)', () => {
  const r = decideBinding('H100', CATALOG)
  assert.equal(r.decision, 'candidates')
  assert.ok(r.candidates.length >= 1)
  assert.ok(r.candidates.every((c) => c.score >= 40))
})

test('decideBinding — 정확 다수면 후보(모호, 사람/AI 선택)', () => {
  const dupCatalog: CatalogEntry[] = [
    { productId: 'p1', model: 'H100 SXM', memory: '80GB' },
    { productId: 'p2', model: 'H100 SXM', memory: '94GB' },
  ]
  const r = decideBinding('H100 SXM', dupCatalog)
  assert.equal(r.decision, 'candidates')
  assert.equal(r.candidates.length, 2)
})

test('decideBinding — 무유사는 none(억지 바인딩 금지)', () => {
  const r = decideBinding('GB300 NVL72', CATALOG, { threshold: 40 })
  assert.equal(r.decision, 'none')
  assert.deepEqual(r.candidates, [])
})
