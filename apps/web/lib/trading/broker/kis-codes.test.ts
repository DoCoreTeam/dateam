/**
 * 증권사 코드 뜻 표 — **짐작을 안 적는다**
 *
 * 이 표가 화면에 나가는 유일한 번역이다. 틀린 뜻을 적으면 읽는 사람이 엉뚱한 곳을
 * 고치고, 그 사이 진짜 원인은 그대로 남는다 (실측 2026-09-26~29: `kis_APAC0071` 이
 * 나흘째 매분 반복되는 동안 안전 게이트가 닫혀 신호가 0건이었다).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KIS_CODE_MEANING, kisCodeMeaning, BROKER_CALL_LABEL } from './kis-codes.ts'

test('★ 뜻마다 무엇이·어디서·언제 본 것인지가 있다', () => {
  const entries = Object.entries(KIS_CODE_MEANING)
  assert.ok(entries.length > 0, '표가 비었다')
  for (const [code, m] of entries) {
    assert.ok(m.why.trim() !== '', `${code} 에 무엇이 문제인지가 없다`)
    assert.ok(m.how.trim() !== '', `${code} 에 무엇을 하면 풀리는지가 없다`)
    // 「실측」이 없는 줄은 짐작이다. 짐작한 뜻은 읽는 사람을 엉뚱한 곳으로 보낸다
    assert.match(m.source, /실측 \d{4}-\d{2}-\d{2}/, `${code} 의 근거가 실측이 아니다`)
    // 사람이 손대야 풀리는 것과 기다리면 풀리는 것은 할 일이 다르다
    assert.ok(m.tone === 'blocked' || m.tone === 'waiting', `${code} 의 무게가 없다`)
    // 기계 글자를 뜻 자리에 그대로 옮기지 않는다
    assert.equal(/kis_|msg_cd|rt_cd/.test(`${m.why}${m.how}`), false, `${code} 에 기계 글자가 샜다`)
  }
})

test('★ 모르는 코드는 null 이다 — 지어낸 뜻을 붙이면 엉뚱한 곳을 고친다', () => {
  assert.equal(kisCodeMeaning('ZZZ9999'), null)
  assert.equal(kisCodeMeaning(''), null)
  // 앞뒤 공백은 같은 코드로 본다
  assert.ok(kisCodeMeaning(' APAC0071 '))
})

/**
 * 계좌번호가 없다는 답과 속도 제한은 **할 일이 정반대다.**
 * 앞은 사람이 설정을 고쳐야 하고, 뒤는 그냥 기다리면 풀린다.
 */
test('★ 사람이 고칠 것과 기다릴 것을 가른다', () => {
  assert.equal(kisCodeMeaning('APAC0071')?.tone, 'blocked')
  assert.equal(kisCodeMeaning('EGW00201')?.tone, 'waiting')
  assert.equal(kisCodeMeaning('EGW00133')?.tone, 'waiting')
})

test('★ 조회 이름이 사람 말이다 — minuteChart 를 그대로 찍지 않는다', () => {
  // 사유 뒤에 붙는 이름(`readEnvelope` 의 where)이 전부 있어야 한다
  for (const key of ['minuteChart', 'fills', 'nightFills', 'balance', 'nightBalance', 'deposit']) {
    assert.ok(BROKER_CALL_LABEL[key], `${key} 를 사람 말로 안 옮긴다`)
    assert.equal(/[A-Za-z]/.test(BROKER_CALL_LABEL[key]), false, `${key} 의 이름에 기계 글자가 남았다`)
  }
})
