// lib/ui/number-format.test.ts — 화면의 숫자는 쉼표를 단다
//
// **왜 생겼나**(사용자 지적 2026-09-30): 「모든 숫자에 콤마찍는건 기본 아닌가」 —
// AI 트레이딩 현황의 지금 가격이 「1086.44」였다. 자릿수를 세어야 읽히는 숫자는 안 읽힌다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fmtNum, fmtNumOr } from './number-format.ts'
import { groupDigits } from './money-format.ts'

test('천 단위마다 쉼표를 단다', () => {
  assert.equal(fmtNum(1086.44, 2), '1,086.44')
  assert.equal(fmtNum(1234567, 0), '1,234,567')
  assert.equal(fmtNum(999, 0), '999', '천 미만에는 쉼표가 없다')
})

test('소수부에는 쉼표를 안 넣는다 — 0.123456 은 자릿수를 세는 값이 아니다', () => {
  assert.equal(fmtNum(1000.123456, 6), '1,000.123456')
})

test('자릿수를 고정한다 — 표에서 자리가 흔들리면 못 읽는다', () => {
  assert.equal(fmtNum(1086, 2), '1,086.00')
  assert.equal(fmtNum(1086.456, 2), '1,086.46', '반올림은 toFixed 그대로')
})

test('음수는 부호를 떼고 묶는다 — 붙인 채로 묶으면 앞자리를 잘못 센다', () => {
  assert.equal(fmtNum(-1086.44, 2), '-1,086.44')
  assert.equal(fmtNum(-999.5, 0), '-1,000')
})

test('없는 값을 0 으로 지어내지 않는다 — 문구는 부르는 쪽이 정한다', () => {
  for (const bad of [null, undefined, NaN, Infinity, -Infinity]) {
    assert.equal(fmtNum(bad as number | null, 2), null, `${String(bad)} 에 숫자를 지어냈습니다`)
  }
  assert.equal(fmtNumOr(null, '값 없음', 2), '값 없음')
  assert.equal(fmtNumOr(1086.44, '값 없음', 2), '1,086.44')
})

test('자릿수 묶기를 다시 적지 않는다 — money-format 의 groupDigits 와 같은 답이다', () => {
  for (const v of [0, 1, 999, 1000, 1086.44, 1234567.891]) {
    assert.equal(fmtNum(v, 3), groupDigits(v.toFixed(3)), `${v} 에서 두 함수가 갈렸습니다`)
  }
})
