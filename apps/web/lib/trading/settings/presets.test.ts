/**
 * 고를 것 셋 — **지어낸 숫자가 없는가**
 *
 * 프리셋에 값이 붙는 순간 그 값은 권장처럼 읽힌다. 그래서 근거가 있는 것 하나에만
 * 권장을 붙이고, 나머지는 「적게·많게」라는 방향만 말한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { presetsFor, stepFor, canSlide } from './presets.ts'
import { TRADING_SETTINGS } from './registry.ts'

const spec = (key: string) => {
  const found = TRADING_SETTINGS.find((s) => s.key === key)
  assert.ok(found, `${key} 설정이 없다`)
  return found
}

test('★ 권장은 명세가 정한 기본값 하나뿐이다', () => {
  for (const s of TRADING_SETTINGS.filter((x) => x.type === 'number')) {
    const ps = presetsFor(s)
    const rec = ps.filter((p) => p.recommended)
    assert.equal(rec.length, 1, `${s.key} 의 권장이 ${rec.length}개다`)
    assert.equal(rec[0].value, s.defaultValue, `${s.key} 의 권장이 기본값이 아니다`)
  }
})

test('★ 모든 값이 최솟값과 최댓값 안에 있다', () => {
  for (const s of TRADING_SETTINGS.filter((x) => x.type === 'number')) {
    for (const p of presetsFor(s)) {
      if (s.min !== undefined) assert.ok(p.value >= s.min, `${s.key} ${p.label} 이 최솟값 아래다`)
      if (s.max !== undefined) assert.ok(p.value <= s.max, `${s.key} ${p.label} 이 최댓값 위다`)
    }
  }
})

test('★ 같은 값 버튼이 둘이 아니다 — 누르면 다른 일이 날 줄 안다', () => {
  for (const s of TRADING_SETTINGS.filter((x) => x.type === 'number')) {
    const values = presetsFor(s).map((p) => p.value)
    assert.equal(new Set(values).size, values.length, `${s.key} 에 같은 값이 둘이다`)
  }
})

test('★ 정수로 쓰던 값은 정수로 남는다 — 봉 수가 3.5 면 못 쓴다', () => {
  for (const s of TRADING_SETTINGS.filter((x) => x.type === 'number' && Number.isInteger(x.defaultValue))) {
    for (const p of presetsFor(s)) {
      assert.ok(Number.isInteger(p.value), `${s.key} ${p.label} 이 ${p.value} 다`)
    }
  }
})

test('기본값이 0 이면 범위 끝을 쓴다 — 0 만 셋이면 고를 것이 없다', () => {
  const zero = TRADING_SETTINGS.find((s) => s.type === 'number' && s.defaultValue === 0 && s.max !== undefined)
  if (!zero) return
  const ps = presetsFor(zero)
  assert.ok(ps.length >= 2, `${zero.key} 에 고를 것이 하나뿐이다`)
})

test('고르는 값과 켬끔에는 프리셋이 없다', () => {
  assert.deepEqual(presetsFor(spec('decision_tf')), [])
  assert.deepEqual(presetsFor(spec('collect_night_session')), [])
})

test('★ 슬라이더는 양 끝을 알 때만 그린다', () => {
  for (const s of TRADING_SETTINGS.filter((x) => x.type === 'number')) {
    assert.equal(canSlide(s), s.min !== undefined && s.max !== undefined, s.key)
  }
  assert.equal(canSlide(spec('decision_tf')), false, '고르는 값에 슬라이더를 그린다')
})

test('★ 한 칸이 너무 잘아 손으로 못 맞추는 설정이 없다', () => {
  for (const s of TRADING_SETTINGS.filter((x) => x.type === 'number' && canSlide(x))) {
    const steps = ((s.max ?? 0) - (s.min ?? 0)) / stepFor(s)
    assert.ok(steps <= 300, `${s.key} 슬라이더가 ${Math.round(steps)}칸이다`)
    assert.ok(stepFor(s) > 0, `${s.key} 한 칸이 0 이다`)
  }
})

test('★ 세는 대상이 0개가 아니다', () => {
  const nums = TRADING_SETTINGS.filter((s) => s.type === 'number')
  assert.ok(nums.length > 50, `숫자 설정을 ${nums.length}개밖에 못 찾았다`)
  assert.ok(presetsFor(nums[0]).length >= 2, '고를 것을 못 만든다')
})
