import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CrmError } from '../domain/errors.ts'
import { copyName, orderProblem, parseBulk, parseOrder, MAX_BULK } from './pricebook-items.ts'

const IDS = new Set(['a', 'b', 'c'])
const SECS = new Set(['라이선스', '구축비'])

test('순서 저장은 이 제품 품목과 있는 묶음만 받는다', () => {
  assert.equal(orderProblem(IDS, SECS, [{ id: 'a', section: '구축비', position: 0 }, { id: 'b', section: '라이선스', position: 1 }]), null)
  assert.match(orderProblem(IDS, SECS, [{ id: 'x', section: '구축비', position: 0 }]) ?? '', /이 제품의 품목이 아닌/)
  assert.match(orderProblem(IDS, SECS, [{ id: 'a', section: '없는 묶음', position: 0 }]) ?? '', /없는 묶음/)
  assert.match(orderProblem(IDS, SECS, [{ id: 'a', section: '구축비', position: 0 }, { id: 'a', section: '구축비', position: 1 }]) ?? '', /두 번/)
  assert.match(orderProblem(IDS, SECS, [{ id: 'a', section: '구축비', position: -1 }]) ?? '', /순서 값/)
  assert.match(orderProblem(IDS, SECS, []) ?? '', /없어요/)
})

test('순서 목록을 거르고 상한을 넘기면 알아챈다', () => {
  const big = parseOrder(Array.from({ length: MAX_BULK + 5 }, (_, i) => ({ id: `i${i}`, section: '구축비', position: i })))
  assert.equal(big.length, MAX_BULK + 1)
  const ids = new Set(big.map((o) => o.id))
  assert.match(orderProblem(ids, SECS, big) ?? '', /까지/)
  assert.throws(() => parseOrder(null), (e: unknown) => e instanceof CrmError)
})

test('여러 개 작업 입력 — 모르는 작업, 빈 목록, 옮길 묶음 없음은 거절', () => {
  assert.deepEqual(parseBulk({ productId: 'p', ids: ['a', 'a', 'b'], action: 'stop' }), { productId: 'p', ids: ['a', 'b'], action: 'stop', section: null })
  assert.throws(() => parseBulk({ productId: 'p', ids: ['a'], action: 'drop' }))
  assert.throws(() => parseBulk({ productId: 'p', ids: [], action: 'stop' }))
  assert.throws(() => parseBulk({ productId: 'p', ids: ['a'], action: 'move' }))
  assert.throws(() => parseBulk({ ids: ['a'], action: 'stop' }))
  assert.equal(parseBulk({ productId: 'p', ids: ['a'], action: 'move', section: ' 구축비 ' }).section, '구축비')
})

test('복제 이름은 겹치지 않는다', () => {
  assert.equal(copyName('STD', new Set()), 'STD 복사본')
  assert.equal(copyName('STD', new Set(['STD 복사본'])), 'STD 복사본 2')
  assert.equal(copyName('STD', new Set(['STD 복사본', 'STD 복사본 2'])), 'STD 복사본 3')
})
