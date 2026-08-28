// 견적 유효기간 기본값 — 예전엔 `todayPlus(30)` 으로 **코드에 박혀** 있어 바꾸려면 배포를 해야 했다
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseValidDays } from './setting.ts'

test('숫자만 쓰면 일수다 — 「30」은 30일', () => {
  assert.equal(parseValidDays('30'), 30)
  assert.equal(parseValidDays('10'), 10)
  assert.equal(parseValidDays('1'), 1)
})

test('단위를 붙여 써도 읽는다 — 칸을 둘로 나누면 둘이 어긋난다', () => {
  assert.equal(parseValidDays('30일'), 30)
  assert.equal(parseValidDays('3개월'), 90)
  assert.equal(parseValidDays('3달'), 90)
  assert.equal(parseValidDays('1년'), 365)
})

test('공백이 섞여도 읽는다 — 사람이 치는 값이다', () => {
  assert.equal(parseValidDays(' 3 개월 '), 90)
})

test('못 읽으면 30일 — 설정이 이상해도 견적은 만들어져야 한다', () => {
  for (const bad of ['', '   ', '아무거나', '-5', '0', '3.5개월', '1주']) {
    assert.equal(parseValidDays(bad), 30, `«${bad}» 에서 기본값이 안 나왔다`)
  }
})

test('상한이 있다 — 「9999개월」이면 날짜 칸이 감당 못 한다', () => {
  assert.equal(parseValidDays('9999개월'), 3650)
  assert.equal(parseValidDays('100년'), 3650)
})
