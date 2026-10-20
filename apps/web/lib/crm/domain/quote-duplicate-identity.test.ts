import { test } from 'node:test'
import assert from 'node:assert/strict'
import { duplicateIdentity, baseQuoteTitle, nextVariantLabel } from './quote-duplicate-identity.ts'

const BASE = '숙명여대 교수 연구용 gcube 도입 견적'

test('다른 안은 원본의 판 번호를 물려받지 않고 1 에서 시작한다', () => {
  const made = duplicateIdentity({ title: BASE, revision: 2, variantLabel: null }, 'variant', 'gcube edge')
  assert.deepEqual(made, { title: BASE, revision: 1, variantLabel: 'gcube edge' })
})

test('안에서 안을 만들어도 제목에 꼬리가 쌓이지 않는다', () => {
  const made = duplicateIdentity(
    { title: `${BASE} (gcube edge)`, revision: 2, variantLabel: 'gcube edge' }, 'variant', '3안')
  assert.equal(made.title, BASE)
  assert.equal(made.variantLabel, '3안')
})

test('안 이름이 비면 다른 안으로 부른다', () => {
  assert.equal(duplicateIdentity({ title: BASE, revision: 1, variantLabel: null }, 'variant', null).variantLabel, '다른 안')
})

test('개정은 판 번호를 올리고 제목과 안 이름을 그대로 둔다', () => {
  const made = duplicateIdentity({ title: BASE, revision: 2, variantLabel: '2안' }, 'revision', null)
  assert.deepEqual(made, { title: BASE, revision: 3, variantLabel: '2안' })
})

test('제목이 안 이름 꼬리로 끝나지 않으면 건드리지 않는다', () => {
  assert.equal(baseQuoteTitle('견적 (gcube edge) 수정본', 'gcube edge'), '견적 (gcube edge) 수정본')
  assert.equal(baseQuoteTitle(BASE, null), BASE)
})

test('기본 안 이름은 이미 있는 안 수로 센다', () => {
  assert.equal(nextVariantLabel([{ variantLabel: null }]), '2안')
  assert.equal(nextVariantLabel([{ variantLabel: null }, { variantLabel: 'gcube edge' }]), '3안')
})
