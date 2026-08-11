import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  median, computeOutlierIndex, computeTopPercentile, computeVelocityPerHour, computeAll,
} from './outlier.ts'

test('중앙값은 홀수·짝수 개수를 모두 처리한다', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 2, 3]), 2.5)
  assert.equal(median([]), null)
})

test('비교군이 8개 미만이면 배수를 내지 않는다', () => {
  const r = computeOutlierIndex({ views: 10000, baselineViews: [100, 200, 300, 400, 500, 600, 700] })
  assert.equal(r.index, null)
  assert.equal(r.baselineN, 7)
})

test('비교군이 충분하면 중앙값 대비 배수를 낸다', () => {
  const base = [100, 100, 100, 100, 100, 100, 100, 100]  // 중앙값 100
  const r = computeOutlierIndex({ views: 840, baselineViews: base })
  assert.equal(r.baselineN, 8)
  assert.equal(r.index, 8.4)
})

test('조회수를 모르면 배수도 없다 (0으로 위장하지 않는다)', () => {
  const base = Array(10).fill(100)
  assert.equal(computeOutlierIndex({ views: null, baselineViews: base }).index, null)
})

test('비교군이 전부 0이면 배수를 내지 않는다 (0으로 나누지 않는다)', () => {
  const r = computeOutlierIndex({ views: 500, baselineViews: Array(10).fill(0) })
  assert.equal(r.index, null)
})

test('모집단 30 미만이면 백분위를 내지 않는다', () => {
  assert.equal(computeTopPercentile(500, Array.from({ length: 29 }, (_, i) => i)), null)
})

test('백분위는 상위 기준으로 뒤집어 나온다', () => {
  const pop = Array.from({ length: 100 }, (_, i) => i + 1)   // 1..100
  // 97보다 작은 값이 96개 → 하위 96% → 상위 4%
  assert.equal(computeTopPercentile(97, pop), 4)
  // 최상위
  assert.ok((computeTopPercentile(100, pop) ?? 100) <= 1)
})

test('스냅샷 1점으로는 속도를 내지 않는다', () => {
  assert.equal(computeVelocityPerHour([{ capturedAt: '2026-08-11T00:00:00Z', views: 100 }]), null)
  assert.equal(computeVelocityPerHour([]), null)
})

test('스냅샷 2점이면 시간당 증가분을 낸다', () => {
  const v = computeVelocityPerHour([
    { capturedAt: '2026-08-11T00:00:00Z', views: 100 },
    { capturedAt: '2026-08-11T10:00:00Z', views: 1100 },
  ])
  assert.equal(v, 100)
})

test('조회수가 줄어든 구간은 속도로 환산하지 않는다 (이상 신호)', () => {
  const v = computeVelocityPerHour([
    { capturedAt: '2026-08-11T00:00:00Z', views: 1000 },
    { capturedAt: '2026-08-11T10:00:00Z', views: 500 },
  ])
  assert.equal(v, null)
})

test('순서가 뒤섞인 스냅샷도 시간순으로 정렬해 계산한다', () => {
  const v = computeVelocityPerHour([
    { capturedAt: '2026-08-11T10:00:00Z', views: 1100 },
    { capturedAt: '2026-08-11T00:00:00Z', views: 100 },
  ])
  assert.equal(v, 100)
})

test('파생값 일괄 계산 — 표본이 얇으면 신뢰도가 insufficient로 떨어진다', () => {
  const r = computeAll({
    views: 500,
    baselineViews: [100, 200],
    topicPopulation: [],
    snapshots: [],
    completeness: 1,
    comparability: 'A',
  })
  assert.equal(r.outlierIndex, null)
  assert.equal(r.topicPercentile, null)
  assert.equal(r.confidence, 'insufficient')
})

test('파생값 일괄 계산 — 표본·완전도·등급이 모두 충족되면 high', () => {
  const r = computeAll({
    views: 1000,
    baselineViews: Array(20).fill(100),
    topicPopulation: Array.from({ length: 50 }, (_, i) => i * 10),
    snapshots: [
      { capturedAt: '2026-08-10T00:00:00Z', views: 100 },
      { capturedAt: '2026-08-11T00:00:00Z', views: 1000 },
    ],
    completeness: 1,
    comparability: 'A',
  })
  assert.equal(r.outlierIndex, 10)
  assert.equal(r.outlierBaselineN, 20)
  assert.equal(r.confidence, 'high')
  assert.equal(r.velocityPerHour, 37.5)
})
