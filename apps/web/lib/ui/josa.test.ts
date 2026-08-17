// lib/ui/josa.test.ts — 한국어 조사 SSOT
//
// 실측 사고: 영업 단계 화면이 "지금 여기 있는 1건은 회사을(를) 모두 채웠어요"를 그대로 띄웠다.
// tsc·단위테스트·design:check 는 전부 초록이었다 — 문법은 정적 검사가 볼 수 없다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eulReul, iGa, eunNeun, gwaWa, euroRo, withJosa } from './josa.ts'

test('받침이 없으면 를·가·는·와 — 이 화면에서 실제로 틀렸던 자리', () => {
  assert.equal(eulReul('회사'), '를')   // 사고 그 자체: "회사을(를)" 이었다
  assert.equal(eulReul('마감 예정일'), '을')
  assert.equal(iGa('회사'), '가')
  assert.equal(eunNeun('회사'), '는')
  assert.equal(gwaWa('회사'), '와')
})

test('받침이 있으면 을·이·은·과', () => {
  assert.equal(eulReul('금액'), '을')
  assert.equal(iGa('금액'), '이')
  assert.equal(eunNeun('금액'), '은')
  assert.equal(gwaWa('금액'), '과')
})

test('실제 조건 이름 다섯 개가 전부 자연스럽다 — 화면에 그대로 나가는 말이다', () => {
  const cases: [string, string][] = [
    ['금액', '금액을'],
    ['마감 예정일', '마감 예정일을'],
    ['고객 담당자', '고객 담당자를'],
    ['회사', '회사를'],
    ['다음 할 일', '다음 할 일을'],
  ]
  for (const [word, expected] of cases) {
    assert.equal(withJosa(word, eulReul), expected, `${word} 뒤 조사가 어색하다`)
  }
})

test('ㄹ 받침은 "로"다 — 으로를 붙이면 서울으로가 된다', () => {
  assert.equal(euroRo('서울'), '로')
  assert.equal(euroRo('결과'), '로')
  assert.equal(euroRo('블록'), '으로')
})

test('★ 한글이 아니면 지어내지 않고 두 형태를 보여 준다 — 틀린 조사보다 낫다', () => {
  // 발음을 알 수 없는 말에 조사를 찍으면 반은 틀린다. 그 절반이 사용자 눈에 남는다.
  assert.equal(eulReul('CRM'), '을(를)')
  assert.equal(iGa('GPU'), '이(가)')
  assert.equal(euroRo('API'), '(으)로')
})

test('빈 값·공백에서 터지지 않는다 — 이름이 비는 경로가 실제로 있다', () => {
  assert.equal(eulReul(''), '을(를)')
  assert.equal(eulReul('   '), '을(를)')
  assert.equal(eulReul('회사  '), '를', '뒤 공백 때문에 판정이 바뀌면 안 된다')
})
