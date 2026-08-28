import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readApiError, readApiErrorCode, describeFetchFailure } from './read-error.ts'

test('서버가 준 이유를 그대로 쓴다 — 뭉개면 사용자는 같은 값을 다시 넣는다', () => {
  assert.equal(readApiError({ error: { message: '현물이 사업비를 넘습니다' } }, '실패'), '현물이 사업비를 넘습니다')
})

test('옛 라우트의 평평한 모양도 받는다', () => {
  assert.equal(readApiError({ message: '평평함' }, '실패'), '평평함')
})

test('이유가 없으면 준비된 말로', () => {
  for (const body of [null, undefined, {}, { error: {} }, { error: { message: '  ' } }, 'text'])
    assert.equal(readApiError(body, '견적서를 불러오지 못했습니다.'), '견적서를 불러오지 못했습니다.')
})

test('코드는 따로 읽는다 — 기계는 코드를, 사람은 문장을', () => {
  assert.equal(readApiErrorCode({ error: { code: 'DUPLICATE' } }), 'DUPLICATE')
  assert.equal(readApiErrorCode({}), null)
})

test('연결 실패는 «잠시 후 다시»라고 하지 않는다 — 다시 눌러도 똑같이 실패한다', () => {
  const msg = describeFetchFailure('딜')
  assert.match(msg, /서버에 연결하지 못해/)
  assert.match(msg, /관리자에게/)
  assert.ok(!msg.includes('잠시 후 다시 시도해 주세요.'), '서버 오류와 같은 말을 하고 있다')
})

test('받침에 따라 을/를 — 화면이 「딜을(를)」이라고 말하지 않게', () => {
  assert.match(describeFetchFailure('딜'), /딜을 /)
  assert.match(describeFetchFailure('견적서'), /견적서를 /)
  assert.match(describeFetchFailure('API'), /API을\(를\) /)
})
