/**
 * 기대값 평균표 — **학습 구간만**, **모름을 0 으로 읽지 않기**
 *
 * 검증 구간 자료로 평균표를 만들면 그 평균표로 검증할 때 자기 답을 보고 푸는 것이 된다.
 * 성적은 늘 좋게 나오고 실전에서 안 재현된다(D-35).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildEvModel, expectedValueFor, meetsMinimumEv, coverage, type EvSample } from './model.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const train = (prob: number, r: number): EvSample => ({ calibratedProb: prob, netPnlR: r, windowKind: 'train' })

const BASE = { version: 'ev-v1', judge: 'jev', direction: 'long' as const, trainFrom: '2026-01-01', trainTo: '2026-06-30' }

function built(samples: readonly EvSample[]) {
  const result = buildEvModel({ ...BASE, samples })
  assert.ok('model' in result, '만들지 못했다')
  return result.model
}

test('★ 학습 구간 아닌 자료가 섞이면 거부한다 — 걸러 내고 조용히 만들지 않는다', () => {
  const result = buildEvModel({
    ...BASE,
    samples: [train(0.6, 0.5), { calibratedProb: 0.7, netPnlR: 2, windowKind: 'validate' }],
  })
  assert.ok('rejection' in result)
  assert.match(result.rejection.reason, /^non_train_samples:1/)
  assert.ok(result.rejection.userMessage.includes('자기 답을 보고'))
})

test('Lockbox 자료도 거부한다', () => {
  const result = buildEvModel({
    ...BASE, samples: [train(0.6, 0.5), { calibratedProb: 0.7, netPnlR: 2, windowKind: 'lockbox' }],
  })
  assert.ok('rejection' in result)
})

test('표본이 없으면 거부한다', () => {
  const result = buildEvModel({ ...BASE, samples: [] })
  assert.ok('rejection' in result)
  assert.equal(result.rejection.reason, 'no_samples')
})

test('구간별 실제 순손익 평균을 낸다', () => {
  const model = built([train(0.15, -1), train(0.15, -0.5), train(0.85, 2), train(0.85, 1)])
  assert.equal(model.buckets[1].meanNetPnlR, -0.75)
  assert.equal(model.buckets[8].meanNetPnlR, 1.5)
})

test('★ 표본이 없는 구간은 0 이 아니라 null — 0 으로 읽으면 기대값 0 짜리가 기준을 넘는다', () => {
  const model = built([train(0.85, 2)])
  assert.equal(model.buckets[0].meanNetPnlR, null)
  assert.equal(model.buckets[0].sampleCount, 0)
  assert.equal(expectedValueFor(model, 0.05), null, '빈 구간에서 값이 나왔다')
})

test('확률로 구간을 찾아 기대값을 준다', () => {
  const model = built([train(0.85, 2), train(0.85, 1)])
  const ev = expectedValueFor(model, 0.87)
  assert.equal(ev?.value, 1.5)
  assert.equal(ev?.sampleCount, 2)
  // 1.0 은 마지막 구간에 들어간다
  assert.ok(expectedValueFor(built([train(1, 3)]), 1))
})

test('★ 표본이 기준보다 적은 구간은 안 쓴다 — 한 건 평균으로 신호를 내지 않는다', () => {
  const model = built([train(0.85, 2)])
  assert.ok(expectedValueFor(model, 0.85, 1))
  assert.equal(expectedValueFor(model, 0.85, 10), null)
})

test('★ SR-01 은 기대값이 최소값 이상일 때만 통과한다', () => {
  assert.deepEqual(meetsMinimumEv({ value: 0.3 }, 0.1), { ok: true })
  const low = meetsMinimumEv({ value: 0.05 }, 0.1)
  assert.equal(low.ok, false)
  assert.match(low.ok === false ? low.reason : '', /^ev_below_minimum/)
  assert.deepEqual(meetsMinimumEv(null, 0.1), { ok: false, reason: 'no_ev_for_bucket' })
})

test('★ 기대값에서 비용을 또 빼지 않는다 (D-34) — 들어온 값에 이미 들어 있다', () => {
  const src = readFileSync(join(HERE, 'model.ts'), 'utf8')
  const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  for (const pattern of [/-\s*cost/i, /minus.*fee/i, /netPnlR\s*-\s*\w*[Cc]ost/]) {
    assert.equal(pattern.test(body), false, '기대값에서 비용을 또 뺀다 — 이중 차감이다')
  }
})

test('어느 구간이 비었는지 셀 수 있다', () => {
  const model = built([train(0.15, -1), train(0.85, 2)])
  assert.deepEqual(coverage(model), { filled: 2, empty: 8, total: 10 })
})
