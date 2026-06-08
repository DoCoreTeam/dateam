import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  STANDARD_LADDER,
  roundUpToStandard,
  isStandardConfig,
  perGpuUnitPrice,
  priceForStandardConfig,
} from './config-ladder.ts'

describe('STANDARD_LADDER', () => {
  test('표준 사다리 값이 [1,2,4,8]', () => {
    assert.deepEqual([...STANDARD_LADDER], [1, 2, 4, 8])
  })
})

describe('roundUpToStandard — 경계값 전체', () => {
  test('표준단 자신은 그대로', () => {
    assert.equal(roundUpToStandard(1), 1)
    assert.equal(roundUpToStandard(2), 2)
    assert.equal(roundUpToStandard(4), 4)
    assert.equal(roundUpToStandard(8), 8)
  })

  test('비표준 → 다음 표준단으로 올림', () => {
    assert.equal(roundUpToStandard(3), 4)  // x3 → x4 (핵심 시나리오)
    assert.equal(roundUpToStandard(5), 8)
    assert.equal(roundUpToStandard(6), 8)
    assert.equal(roundUpToStandard(7), 8)
  })

  test('n > 8 → 클램프 8', () => {
    assert.equal(roundUpToStandard(9), 8)
    assert.equal(roundUpToStandard(16), 8)
    assert.equal(roundUpToStandard(100), 8)
  })

  test('n <= 0 방어 → 1', () => {
    assert.equal(roundUpToStandard(0), 1)
    assert.equal(roundUpToStandard(-1), 1)
    assert.equal(roundUpToStandard(-8), 1)
  })

  test('NaN / Infinity 방어 → 1', () => {
    assert.equal(roundUpToStandard(NaN), 1)
    assert.equal(roundUpToStandard(Infinity), 1)
    assert.equal(roundUpToStandard(-Infinity), 1)
  })

  test('소수점 올림 (2.5 → 4)', () => {
    assert.equal(roundUpToStandard(2.5), 4)
    assert.equal(roundUpToStandard(1.1), 2)
  })
})

describe('isStandardConfig', () => {
  test('표준단 true', () => {
    assert.equal(isStandardConfig(1), true)
    assert.equal(isStandardConfig(2), true)
    assert.equal(isStandardConfig(4), true)
    assert.equal(isStandardConfig(8), true)
  })

  test('비표준 false', () => {
    assert.equal(isStandardConfig(3), false)
    assert.equal(isStandardConfig(5), false)
    assert.equal(isStandardConfig(0), false)
    assert.equal(isStandardConfig(16), false)
  })
})

describe('perGpuUnitPrice — 1장 환산', () => {
  test('기본 환산', () => {
    assert.equal(perGpuUnitPrice(53.591, 8), 6.6989)
    assert.equal(perGpuUnitPrice(3.24, 1), 3.24)
    assert.equal(perGpuUnitPrice(13.8, 2), 6.9)
  })

  test('count=0 방어 → count=1로 처리', () => {
    assert.equal(perGpuUnitPrice(10, 0), 10)
    assert.equal(perGpuUnitPrice(10, -1), 10)
  })

  test('NaN count 방어', () => {
    assert.equal(perGpuUnitPrice(10, NaN), 10)
  })

  test('totalUnit=NaN → 0', () => {
    assert.equal(perGpuUnitPrice(NaN, 4), 0)
  })
})

describe('priceForStandardConfig — 구성 총 단가 환산', () => {
  test('per_gpu × count 정밀도 일치', () => {
    assert.equal(priceForStandardConfig(3.24, 1), 3.24)
    assert.equal(priceForStandardConfig(3.24, 2), 6.48)
    assert.equal(priceForStandardConfig(3.24, 4), 12.96)
    assert.equal(priceForStandardConfig(3.24, 8), 25.92)
  })

  test('count=0 방어 → count=1로 처리', () => {
    assert.equal(priceForStandardConfig(5.0, 0), 5.0)
  })

  test('perGpu=NaN → 0', () => {
    assert.equal(priceForStandardConfig(NaN, 4), 0)
  })

  test('정밀도 — 소수 4자리 반올림', () => {
    // 6.6989 × 8 = 53.5912 → round to 53.5912
    assert.equal(priceForStandardConfig(6.6989, 8), 53.5912)
  })

  test('perGpu×target 역방향 검증 — perGpuUnitPrice와 대칭', () => {
    const total = 53.591
    const count = 8
    const perGpu = perGpuUnitPrice(total, count)
    // 역산: priceForStandardConfig(perGpu, count) ≈ total (소수 반올림 오차 허용)
    const reconstructed = priceForStandardConfig(perGpu, count)
    assert.ok(Math.abs(reconstructed - total) < 0.001, `역산 오차 초과: ${reconstructed} vs ${total}`)
  })
})
