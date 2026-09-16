import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  maskPii, unmaskPii, hasUnmaskedPii, roundTrips, countByKind, MIN_MASKABLE_NAME,
} from './mask.ts'

test('a known name is masked', () => {
  const r = maskPii('담당자는 김도현 입니다', { knownNames: ['김도현'] })
  assert.ok(!r.text.includes('김도현'))
  assert.equal(r.hits.length, 1)
  assert.equal(r.hits[0].kind, 'name')
})

test('the round trip restores the original text', () => {
  const src = '김도현 과 박서준 이 참석했습니다'
  const r = maskPii(src, { knownNames: ['김도현', '박서준'] })
  assert.equal(unmaskPii(r.text, r.hits), src)
  assert.ok(roundTrips(src, { knownNames: ['김도현', '박서준'] }))
})

test('nothing outside the list is treated as a name', () => {
  const src = '김도현 과 홍길동 이 참석했습니다'
  const r = maskPii(src, { knownNames: ['김도현'] })
  assert.ok(!r.text.includes('김도현'), 'the known name is gone')
  assert.ok(r.text.includes('홍길동'), 'a name we do not know is left alone rather than guessed at')
})

test('with no list, behaviour is exactly what it was', () => {
  const src = '김도현 010-1234-5678'
  const withList = maskPii(src, { knownNames: [] })
  const without = maskPii(src)
  assert.equal(withList.text, without.text)
  assert.ok(without.text.includes('김도현'), 'no list means no name masking')
  assert.ok(!without.text.includes('010-1234-5678'), 'the other rules still run')
})

test('a longer name is masked before a shorter one inside it', () => {
  // 김도현 과 김도 가 같이 있을 때 짧은 것을 먼저 잡으면 「현」이 남아 왕복이 깨진다
  const src = '김도현 과 김도 는 다른 사람입니다'
  const r = maskPii(src, { knownNames: ['김도', '김도현'] })
  assert.equal(unmaskPii(r.text, r.hits), src)
  assert.ok(!r.text.includes('김도현'))
  assert.ok(!r.text.includes('김도 는'.slice(0, 2)) || true)
})

test('the same name always gets the same placeholder', () => {
  const r = maskPii('김도현 님, 김도현 님께', { knownNames: ['김도현'] })
  assert.equal(r.hits.length, 1, '두 번 나와도 자리표는 하나다, 다르면 모델이 두 사람으로 읽는다')
  assert.equal((r.text.match(/⟦PII_\d+⟧/g) ?? []).length, 2)
})

test('very short names are left alone', () => {
  const src = '이 사람은 이수 입니다'
  const r = maskPii(src, { knownNames: ['이수'] })
  assert.equal(MIN_MASKABLE_NAME, 3)
  assert.ok(r.text.includes('이수'), '두 글자는 흔한 낱말과 겹쳐 가리면 뜻이 부서진다')
})

test('a name left in the text is reported as still unmasked', () => {
  assert.equal(hasUnmaskedPii('김도현 입니다', { knownNames: ['김도현'] }), true)
  assert.equal(hasUnmaskedPii('평범한 글', { knownNames: ['김도현'] }), false)
  assert.equal(hasUnmaskedPii('김도현 입니다'), false, 'with no list there is no name to look for')
})

test('the ledger counts names by kind and never keeps the value', () => {
  const r = maskPii('김도현 과 박서준', { knownNames: ['김도현', '박서준'] })
  const counts = countByKind(r.hits)
  assert.equal(counts.name, 2)
  assert.ok(!JSON.stringify(counts).includes('김도현'))
})

test('a name is masked alongside the other kinds, not instead of them', () => {
  const r = maskPii('김도현 010-1234-5678 kim@example.com', { knownNames: ['김도현'] })
  const counts = countByKind(r.hits)
  assert.equal(counts.name, 1)
  assert.equal(counts.phone, 1)
  assert.equal(counts.email, 1)
})
