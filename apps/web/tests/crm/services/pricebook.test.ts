/**
 * 가격 기준 서비스 — 실 DB 검증 (P0135 I08)
 *
 * **운영 워크스페이스를 쓰지 않는다.** 가격 이력은 지울 수 없는 표라(마이그 310 트리거)
 * 운영 워크스페이스에서 돌리면 시험 줄이 운영 이력에 영원히 남는다.
 * 그래서 전용 워크스페이스(ws_test_pricebook, 구성원 0명이라 아무도 못 본다)에서 돌린다.
 * 만든 제품 품목 규칙은 끝에서 id 로 지운다. 이력 줄은 그 워크스페이스에 남는다.
 *
 * 되돌리기: DELETE FROM crm_price_history WHERE "workspaceId"='ws_test_pricebook' 는 트리거가 막으므로
 *           트리거를 잠시 끄고 지운 뒤 crm_workspace 의 그 줄을 지운다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadEnv } from '../integrity/_helpers.ts'
import { getCrmDb } from '../../../lib/crm/db/client.ts'
import {
  createPriceProduct, updatePriceProduct, deletePriceProduct, restorePriceProduct,
  getPriceProduct, writeItemTx, replaceRules, previewPriceProduct, saveExamples, listPriceProducts,
} from '../../../lib/crm/services/pricebook.ts'
import { createProduct, updateProduct } from '../../../lib/crm/services/product.ts'
import { listPriceHistory } from '../../../lib/crm/services/pricebook-history.ts'
import { withCrmTx } from '../../../lib/crm/db/tx.ts'
import { GCUBE_EDGE } from '../../../lib/crm/domain/pricebook/gcube-edge.ts'
import { CrmError } from '../../../lib/crm/domain/errors.ts'

loadEnv()
const WS = 'ws_test_pricebook'
const db = getCrmDb(WS)
const RUN = `t${Date.now().toString(36)}`
const MADE = { products: [] as string[], items: [] as string[] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const raw = db as any

test.before(async () => {
  await raw.crmWorkspace.upsert({ where: { id: WS }, create: { id: WS, name: 'test pricebook' }, update: {} })
})

test.after(async () => {
  if (MADE.items.length) await raw.crmProduct.deleteMany({ where: { id: { in: MADE.items } } })
  if (MADE.products.length) {
    await raw.crmPriceRule.deleteMany({ where: { productId: { in: MADE.products } } })
    await raw.crmProduct.deleteMany({ where: { priceProductId: { in: MADE.products } } })
    await raw.crmPriceProduct.deleteMany({ where: { id: { in: MADE.products }, OR: [{ deletedAt: null }, { deletedAt: { not: null } }] } })
    await raw.crmAuditLog.deleteMany({ where: { targetId: { in: [...MADE.products, ...MADE.items] } } })
  }
})

async function seedEdge(name: string): Promise<string> {
  const { id } = await createPriceProduct(WS, null, { name, sections: GCUBE_EDGE.sections })
  MADE.products.push(id)
  const idMap = new Map<string, string>()
  await withCrmTx(WS, async (tx) => {
    for (let i = 0; i < GCUBE_EDGE.items.length; i++) {
      const it = GCUBE_EDGE.items[i]
      const newId = await writeItemTx(tx, WS, null, id, { ...it, id: undefined }, i, { sourceKind: 'SEED' })
      idMap.set(it.id, newId)
    }
  })
  const remap = (s: string) => idMap.get(s) ?? s
  const rules = GCUBE_EDGE.rules.map((r) => JSON.parse(JSON.stringify(r), (k, v) => (typeof v === 'string' && idMap.has(v) ? remap(v) : Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? remap(x) : x)) : v)))
  const d = await getPriceProduct(db, id)
  await replaceRules(WS, null, id, d.product.version ?? 0, rules)
  const ex = GCUBE_EDGE.examples![0]
  const d2 = await getPriceProduct(db, id)
  await saveExamples(WS, null, id, d2.product.version ?? 0, [{ ...ex, conditions: { ...ex.conditions, picked: ex.conditions.picked.map(remap) } }])
  return id
}

test('★ gcube edge 를 DB 에 넣고 미리 계산하면 128,400,000 원, 예시 재현 맞음', async () => {
  const id = await seedEdge(`edge ${RUN}`)
  const p = await previewPriceProduct(db, id, null)
  assert.equal(p.result.tcoMinor, BigInt(128_400_000))
  assert.equal(p.examples[0].ok, true, p.examples[0].mismatches.join(', '))
  const listed = await listPriceProducts(db, { q: RUN })
  assert.equal(listed[0].itemCount, GCUBE_EDGE.items.length)
  assert.equal(listed[0].ruleCount, GCUBE_EDGE.rules.length)
})

test('모양이 틀린 규칙은 끈 채로 저장되고 사유가 남는다', async () => {
  const { id } = await createPriceProduct(WS, null, { name: `rules ${RUN}` })
  MADE.products.push(id)
  const r = await replaceRules(WS, null, id, 0, [{ kind: 'CAP', item: 'nope', varKey: 'nodes', max: -1 }])
  assert.equal(r.disabled, 1)
  const d = await getPriceProduct(db, id)
  assert.equal(d.rules[0].isEnabled, false)
  assert.match(d.rules[0].disabledReason ?? '', /품목이 없어요/)
})

test('같은 버전으로 두 번 고치면 두 번째가 거절된다', async () => {
  const { id } = await createPriceProduct(WS, null, { name: `lock ${RUN}` })
  MADE.products.push(id)
  await updatePriceProduct(WS, null, id, 0, { descriptionMd: 'a' })
  const e = await updatePriceProduct(WS, null, id, 0, { descriptionMd: 'b' }).then(() => null, (x) => x)
  assert.ok(e instanceof CrmError && e.code === 'CONFLICT')
})

test('제품을 지우면 목록에서 빠지고 되살리면 돌아온다, 그사이 같은 이름이 생기면 막는다', async () => {
  const name = `trash ${RUN}`
  const { id } = await createPriceProduct(WS, null, { name })
  MADE.products.push(id)
  await deletePriceProduct(WS, null, id)
  assert.equal((await listPriceProducts(db, { q: name })).length, 0)
  assert.equal((await listPriceProducts(db, { q: name, trash: true })).length, 1)
  const twin = await createPriceProduct(WS, null, { name })
  MADE.products.push(twin.id)
  const e = await restorePriceProduct(WS, null, id).then(() => null, (x) => x)
  assert.ok(e instanceof CrmError && e.code === 'VALIDATION_FAILED')
  await deletePriceProduct(WS, null, twin.id)
  await restorePriceProduct(WS, null, id)
  assert.equal((await listPriceProducts(db, { q: name })).length, 1)
})

test('★ 정상가를 고치면 가격 이력에 새 줄 — 덮지 않는다, 이력은 고칠 수 없다', async () => {
  const made = await createProduct(WS, null, { name: `price ${RUN}`, unitPriceMinor: '7000000' })
  MADE.items.push(made.id)
  await updateProduct(WS, null, made.id, { unitPriceMinor: '7300000' })
  const h = await listPriceHistory(db, 'ITEM', made.id)
  assert.deepEqual(h.map((x) => x.amountMinor?.toString()), ['7300000', '7000000'])
  const blocked = await raw.crmPriceHistory.updateMany({ where: { id: h[0].id }, data: { amountMinor: BigInt(1) } }).then(() => null, (x: unknown) => x)
  assert.ok(blocked, '트리거가 고치기를 막는다')
})

test('품목 결함 1: 같은 이름으로 만들면 친 단가를 버리지 않는다 (있던 값이 0원이면 채운다)', async () => {
  const name = `dup ${RUN}`
  const a = await createProduct(WS, null, { name })
  MADE.items.push(a.id)
  const b = await createProduct(WS, null, { name, unitPriceMinor: '17600000' })
  assert.equal(b.id, a.id)
  assert.equal(b.existed, true)
  assert.equal(b.unitPriceMinor.toString(), '17600000')
})

test('품목 결함 2: 다시 판매할 때도 이름 중복을 본다', async () => {
  const name = `revive ${RUN}`
  const a = await createProduct(WS, null, { name })
  MADE.items.push(a.id)
  await updateProduct(WS, null, a.id, { isActive: false })
  const b = await createProduct(WS, null, { name })
  MADE.items.push(b.id)
  const e = await updateProduct(WS, null, a.id, { isActive: true }).then(() => null, (x) => x)
  assert.ok(e instanceof CrmError && e.code === 'VALIDATION_FAILED')
})

test('품목 결함 3: 버전을 보내면 잠금이 걸린다', async () => {
  const a = await createProduct(WS, null, { name: `ver ${RUN}` })
  MADE.items.push(a.id)
  await updateProduct(WS, null, a.id, { unit: '식', version: a.version })
  const e = await updateProduct(WS, null, a.id, { unit: '대', version: a.version }).then(() => null, (x) => x)
  assert.ok(e instanceof CrmError && e.code === 'CONFLICT')
})
