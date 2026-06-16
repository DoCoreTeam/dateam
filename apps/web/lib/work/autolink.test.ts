import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bandOf, entityHighAllowed, decideLinks, adjustThreshold, DEFAULT_THRESHOLDS, type JudgedCandidate } from './autolink.ts'

test('bandOf: 업무는 낮은 임계, 거래처는 높은 임계(비대칭)', () => {
  assert.equal(bandOf(0.83, 'log'), 'high')      // log tau_auto 0.82
  assert.equal(bandOf(0.83, 'account'), 'mid')   // account tau_auto 0.88 → 0.83은 mid
  assert.equal(bandOf(0.5, 'log'), 'low')
})

test('bandOf: 프로젝트는 자동확정 금지(high 진입 불가) — 항상 mid/low', () => {
  // project tau_auto 1.01 → 어떤 신뢰도도 high 불가. tau_suggest 0.62.
  assert.equal(bandOf(0.95, 'project'), 'mid')   // 0.95 < 1.01 → high 아님, ≥0.62 → mid(추천)
  assert.equal(bandOf(1.0, 'project'), 'mid')    // 최상 신뢰도라도 high 불가
  assert.equal(bandOf(0.62, 'project'), 'mid')   // 경계: tau_suggest 정확히 충족
  assert.equal(bandOf(0.5, 'project'), 'low')    // 0.5 < 0.62 → low(버림)
})

test('decideLinks: 프로젝트는 high로 확정되지 않음(제안만)', () => {
  const cands: JudgedCandidate[] = [
    { id: 'pj1', kind: 'project', confidence: 0.95, related: true, relation: 'related', reason: 'x', nameSim: 0.9 },
  ]
  const out = decideLinks(cands)
  assert.equal(out.length, 1)
  assert.equal(out[0].band, 'mid')   // 이름 겹침 충족해도 tau_auto 1.01이라 high 불가
  assert.equal(out[0].weak, true)    // 추천(점선)
})

test('entityHighAllowed: 이름 겹침 가드', () => {
  assert.equal(entityHighAllowed(0.4), true)
  assert.equal(entityHighAllowed(0.1), false)
})

test('decideLinks: related=false·low는 버림', () => {
  const cands: JudgedCandidate[] = [
    { id: 'a', kind: 'log', confidence: 0.9, related: true, relation: 'related', reason: 'x' },
    { id: 'b', kind: 'log', confidence: 0.9, related: false, relation: 'related', reason: 'x' },
    { id: 'c', kind: 'log', confidence: 0.3, related: true, relation: 'related', reason: 'x' },
  ]
  const out = decideLinks(cands)
  assert.equal(out.length, 1)
  assert.equal(out[0].id, 'a')
  assert.equal(out[0].band, 'high')
  assert.equal(out[0].weak, false)
})

test('decideLinks: 엔티티 high인데 이름 겹침 없으면 mid로 강등(가드)', () => {
  const cands: JudgedCandidate[] = [
    { id: 'acc1', kind: 'account', confidence: 0.95, related: true, relation: 'about_account', reason: 'x', nameSim: 0.05 },
  ]
  const out = decideLinks(cands)
  assert.equal(out[0].band, 'mid')   // high였지만 이름 가드 미충족 → mid
  assert.equal(out[0].weak, true)
})

test('decideLinks: 엔티티 high + 이름 겹침 충족 → high 유지', () => {
  const cands: JudgedCandidate[] = [
    { id: 'acc1', kind: 'account', confidence: 0.95, related: true, relation: 'about_account', reason: 'x', nameSim: 0.6 },
  ]
  assert.equal(decideLinks(cands)[0].band, 'high')
})

test('adjustThreshold: 표본 부족이면 변경 없음', () => {
  const r = adjustThreshold(DEFAULT_THRESHOLDS.log, { autoCreated: 3, unlinked: 2 })
  assert.equal(r.tau_auto, DEFAULT_THRESHOLDS.log.tau_auto)
})

test('adjustThreshold: 해제율 높으면 엄격(tau_auto 상향)', () => {
  const r = adjustThreshold(DEFAULT_THRESHOLDS.log, { autoCreated: 20, unlinked: 8 })
  assert.ok(r.tau_auto > DEFAULT_THRESHOLDS.log.tau_auto)
})

test('adjustThreshold: 해제율 낮으면 공격적(tau_auto 하향)', () => {
  const r = adjustThreshold(DEFAULT_THRESHOLDS.log, { autoCreated: 40, unlinked: 1 })
  assert.ok(r.tau_auto < DEFAULT_THRESHOLDS.log.tau_auto)
})
