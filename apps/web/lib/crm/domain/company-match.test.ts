/**
 * 회사명 대조 열쇠 — **잡아야 할 것**과 **잡으면 안 되는 것**을 함께 잠근다.
 *
 * 이 가드의 절반은 «같게 만들지 마라»다. 중복은 나중에 합칠 수 있지만
 * 과병합은 되돌릴 수 없다 — 합쳐진 두 회사의 딜·인물·견적이 섞이면 무엇이 누구 것이었는지
 * 알 방법이 없다. 그래서 느슨하게 만들고 싶어질 때 이 파일이 막는다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { companyMatchKey } from './normalize.ts'

test('표기만 다른 같은 이름은 같은 열쇠가 된다', () => {
  // 실제로 두 벌로 남아 있던 것 — 이 가드가 생긴 이유다
  assert.equal(companyMatchKey('konst tech'), companyMatchKey('KONST Tech.'))
  assert.equal(companyMatchKey('Konsttech'), companyMatchKey('konst tech'))

  // 법인격 표기 — 서명마다 다르게 쓴다
  assert.equal(companyMatchKey('(주)가비아'), companyMatchKey('㈜ 가비아'))
  assert.equal(companyMatchKey('주식회사 가비아'), companyMatchKey('가비아'))
  assert.equal(companyMatchKey('Gabia Co., Ltd.'), companyMatchKey('gabia'))
  assert.equal(companyMatchKey('Acme Inc.'), companyMatchKey('ACME'))

  // 구두점·중간 공백
  assert.equal(companyMatchKey('데이터 얼라이언스'), companyMatchKey('데이터얼라이언스'))
  assert.equal(companyMatchKey('e-Gate'), companyMatchKey('eGate'))
})

test('비슷하기만 한 이름은 절대 같아지지 않는다', () => {
  const pairs: readonly [string, string][] = [
    ['대한전선', '대한전기'],
    ['한국전력공사', '한국전력기술'],
    ['삼성전자', '삼성전기'],
    ['수원시', '수원시청'],
    ['KT', 'KTB'],
    ['충남테크노파크', '충북테크노파크'],
    ['가비아', '가비아씨엔에스'],
  ]
  for (const [a, b] of pairs) {
    assert.notEqual(companyMatchKey(a), companyMatchKey(b), `${a} ≠ ${b} 여야 한다`)
  }
})

test('판정할 수 없으면 null — 아무거나 물어 오지 않는다', () => {
  assert.equal(companyMatchKey(''), null)
  assert.equal(companyMatchKey('   '), null)
  assert.equal(companyMatchKey(null), null)
  assert.equal(companyMatchKey(undefined), null)
  // 법인격만 있는 이름 → 남는 글자가 없다
  assert.equal(companyMatchKey('(주)'), null)
  assert.equal(companyMatchKey('주식회사'), null)
  // 한 글자는 판정하지 않는다 — 「A」가 「A」인 회사를 아무거나 물어 온다
  assert.equal(companyMatchKey('A'), null)
})

test('열쇠는 저장값이 아니다 — 화면에 쓰면 안 된다', () => {
  // 사람이 읽을 수 없는 형태여야 «표시용으로 쓰자»는 생각이 안 든다
  assert.equal(companyMatchKey('(주) 가비아'), '가비아')
  assert.equal(companyMatchKey('KONST Tech.'), 'konsttech')
})
