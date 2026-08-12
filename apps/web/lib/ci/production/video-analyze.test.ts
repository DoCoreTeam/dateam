import { test } from 'node:test'
import assert from 'node:assert/strict'
import { frameDiff, silencesFromRms, peaksFromRms } from './video-analyze.ts'

/** w*h 픽셀을 한 가지 밝기로 채운 프레임을 만든다(RGBA). */
function flatFrame(level: number, px = 64): Uint8ClampedArray {
  const data = new Uint8ClampedArray(px * 4)
  for (let i = 0; i < px; i += 1) {
    data[i * 4] = level; data[i * 4 + 1] = level; data[i * 4 + 2] = level; data[i * 4 + 3] = 255
  }
  return data
}

test('같은 화면은 차이 0 — 멀쩡한 장면을 전환으로 오인하지 않는다', () => {
  const f = flatFrame(120)
  assert.equal(frameDiff(f, f), 0)
})

test('검은 화면 → 흰 화면은 최대 차이', () => {
  assert.equal(frameDiff(flatFrame(0), flatFrame(255)), 1)
})

test('밝기가 조금 흔들리는 정도는 큰 차이로 치지 않는다', () => {
  // 같은 히스토그램 구간(16단계) 안의 변화
  assert.ok(frameDiff(flatFrame(120), flatFrame(124)) < 0.3)
})

test('길이가 다르거나 빈 프레임은 0 — 예외로 분석을 멈추지 않는다', () => {
  assert.equal(frameDiff(new Uint8ClampedArray(0), new Uint8ClampedArray(0)), 0)
  assert.equal(frameDiff(flatFrame(10, 4), flatFrame(10, 8)), 0)
})

test('무음 구간을 찾는다', () => {
  // 0.05초 창 × 20 = 1초. 앞 10창(0.5초) 무음, 뒤 10창 소리
  const rms = [...Array(10).fill(0.001), ...Array(10).fill(0.2)]
  const out = silencesFromRms(rms, 0.05)
  assert.equal(out.length, 1)
  assert.equal(out[0].startSec, 0)
  assert.ok(Math.abs(out[0].endSec - 0.5) < 1e-9)
})

test('짧은 틈(숨 쉬는 정도)은 무음으로 세지 않는다', () => {
  const rms = [...Array(3).fill(0.001), ...Array(10).fill(0.2)] // 0.15초
  assert.deepEqual(silencesFromRms(rms, 0.05), [])
})

test('끝까지 무음이면 마지막 구간도 잡는다', () => {
  const rms = [...Array(10).fill(0.2), ...Array(10).fill(0.001)]
  const out = silencesFromRms(rms, 0.05)
  assert.equal(out.length, 1)
  assert.ok(Math.abs(out[0].startSec - 0.5) < 1e-9)
})

test('소리가 전혀 없으면 피크도 없다 — 0으로 나누지 않는다', () => {
  assert.deepEqual(peaksFromRms(Array(20).fill(0), 0.05), [])
})

test('평균보다 크게 튀는 지점만 피크로 잡는다', () => {
  const rms = Array(40).fill(0.1)
  rms[20] = 0.9
  const peaks = peaksFromRms(rms, 0.05)
  assert.equal(peaks.length, 1)
  assert.ok(Math.abs(peaks[0].atSec - 1.0) < 1e-9)
})

test('연속으로 튀어도 1초 안이면 한 사건으로 접는다', () => {
  const rms = Array(60).fill(0.1)
  rms[20] = 0.9; rms[21] = 0.9; rms[22] = 0.9
  assert.equal(peaksFromRms(rms, 0.05).length, 1)
})
