import { test } from 'node:test'
import assert from 'node:assert/strict'
import { credentialIntent, splitAccountNo, accountShapeFromMask } from './credential-input.ts'

const blank = { appKey: '', appSecret: '', accountNo: '', configured: false }

test('앱키와 시크릿을 둘 다 넣으면 전부 저장이다', () => {
  assert.deepEqual(
    credentialIntent({ ...blank, appKey: 'k', appSecret: 's' }),
    { kind: 'full' },
  )
})

test('이미 넣어 둔 줄이면 계좌번호만 고칠 수 있다 — 안 보이는 값을 다시 적게 하지 않는다', () => {
  assert.deepEqual(
    credentialIntent({ ...blank, accountNo: '12345678-01', configured: true }),
    { kind: 'account_only' },
  )
})

test('아직 아무것도 없으면 계좌번호만으로는 못 만든다 — 반쪽 줄이 생긴다', () => {
  const r = credentialIntent({ ...blank, accountNo: '12345678', configured: false })
  assert.equal(r.kind, 'blocked')
  assert.deepEqual(r.kind === 'blocked' ? [...r.missing] : [], ['앱키', '앱시크릿'])
})

test('한쪽만 넣으면 언제나 막는다 — 빈 쪽으로 덮으면 저장된 값이 사라진다', () => {
  for (const configured of [true, false]) {
    const onlyKey = credentialIntent({ ...blank, appKey: 'k', configured })
    assert.equal(onlyKey.kind, 'blocked')
    assert.deepEqual(onlyKey.kind === 'blocked' ? [...onlyKey.missing] : [], ['앱시크릿'])

    const onlySecret = credentialIntent({ ...blank, appSecret: 's', configured })
    assert.equal(onlySecret.kind, 'blocked')
    assert.deepEqual(onlySecret.kind === 'blocked' ? [...onlySecret.missing] : [], ['앱키'])
  }
})

test('이미 넣어 뒀는데 아무것도 안 적으면 계좌번호를 달라고 한다', () => {
  const r = credentialIntent({ ...blank, configured: true })
  assert.equal(r.kind, 'blocked')
  assert.deepEqual(r.kind === 'blocked' ? [...r.missing] : [], ['계좌번호'])
})

test('열 자리는 여덟 + 둘로 가른다 — 이것이 안 돼서 증권사가 계좌가 없다고 답했다', () => {
  // 가짜 번호다. 시험에 진짜 계좌번호를 적지 않는다
  assert.deepEqual(splitAccountNo('12345678-01'), { cano: '12345678', productCode: '01' })
  assert.deepEqual(splitAccountNo('1234567801'), { cano: '12345678', productCode: '01' })
  assert.deepEqual(splitAccountNo(' 12345678 - 03 '), { cano: '12345678', productCode: '03' })
})

test('여덟 자리는 그대로 두고 상품코드는 설정에 맡긴다', () => {
  assert.deepEqual(splitAccountNo('12345678'), { cano: '12345678', productCode: null })
})

test('모르는 모양은 안 고친다 — 잘라 맞추면 엉뚱한 계좌를 묻는다', () => {
  assert.deepEqual(splitAccountNo('123456789'), { cano: '123456789', productCode: null })
  assert.deepEqual(splitAccountNo('123456789012'), { cano: '123456789012', productCode: null })
  assert.equal(splitAccountNo(''), null)
  assert.equal(splitAccountNo('----'), null)
})

test('가린 번호의 글자 수가 곧 자릿수다 — 번호를 열어 보지 않는다', () => {
  // 실측 2026-09-30 저장된 값: ****6745 (여덟 자리, 뒤 두 자리 없음)
  assert.deepEqual(accountShapeFromMask('****6745'), { digits: 8, hasProductCode: false })
  assert.deepEqual(accountShapeFromMask('******6745'), { digits: 10, hasProductCode: true })
  assert.equal(accountShapeFromMask(null), null)
  assert.equal(accountShapeFromMask('***'), null)
})
