import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countsAsBought, loadOwnedItemsForDeal, ownedFrom, type ContractRow } from './owned-items.ts'

const C = (over: Partial<ContractRow>): ContractRow => ({
  id: 'c', title: '숙명여대 gcube 도입', status: 'CONCLUDED', concludedAt: new Date('2025-03-14T03:00:00Z'), deletedAt: null, quoteId: 'q1', ...over,
})

test('체결되고 지우지 않은 계약만 산 것으로 친다', () => {
  assert.equal(countsAsBought(C({})), true)
  for (const s of ['DRAFT', 'TERMINATED', 'CANCELLED']) assert.equal(countsAsBought(C({ status: s })), false, s)
  assert.equal(countsAsBought(C({ deletedAt: new Date() })), false)
})

test('계약이 가리키는 견적 줄의 품목을 모으고 근거는 최근 체결 계약', () => {
  const lines = new Map([['q1', ['std', 'gpu']], ['q2', ['std']], ['q3', ['ent']]])
  const r = ownedFrom([
    C({ id: 'old', quoteId: 'q1', title: '첫 도입', concludedAt: new Date('2024-01-10T03:00:00Z') }),
    C({ id: 'new', quoteId: 'q2', title: '증설', concludedAt: new Date('2025-03-14T03:00:00Z') }),
    C({ id: 'cancel', quoteId: 'q3', status: 'CANCELLED' }),
  ], lines)
  assert.deepEqual(r.itemIds.sort(), ['gpu', 'std'])
  assert.equal(r.evidence.std, '2025-03-14 체결 증설')
  assert.equal(r.evidence.gpu, '2024-01-10 체결 첫 도입')
})

test('딜이 없거나 회사가 없으면 빈 목록, 회사의 체결 계약만 묻는다', async () => {
  assert.deepEqual((await loadOwnedItemsForDeal({} as never, null)).itemIds, [])
  let asked: unknown = null
  const db = {
    crmDeal: { findFirst: async () => ({ companyId: 'co1' }) },
    crmContract: { findMany: async (q: unknown) => { asked = q; return [C({ quoteId: 'q1' })] } },
    crmQuoteLine: { findMany: async () => [{ quoteId: 'q1', productId: 'std' }, { quoteId: 'q1', productId: null }] },
  }
  const r = await loadOwnedItemsForDeal(db as never, 'd1')
  assert.deepEqual(r.itemIds, ['std'])
  assert.deepEqual((asked as { where: unknown }).where, { status: 'CONCLUDED', deletedAt: null, deal: { companyId: 'co1', deletedAt: null } })
  const noCo = { crmDeal: { findFirst: async () => ({ companyId: null }) } }
  assert.deepEqual((await loadOwnedItemsForDeal(noCo as never, 'd1')).itemIds, [])
})
