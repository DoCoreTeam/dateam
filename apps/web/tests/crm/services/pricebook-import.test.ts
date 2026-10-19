/**
 * 가격표 가져오기 저장 — 실 DB 검증 (P0135 I12)
 *
 * 운영 워크스페이스가 아닌 ws_test_pricebook 에서 돈다(가격 이력은 지울 수 없는 표라서, pricebook.test.ts 참조).
 * 만든 제품과 품목은 끝에서 id 로 지운다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadEnv } from '../integrity/_helpers.ts'
import { getCrmDb } from '../../../lib/crm/db/client.ts'
import { savePriceImport } from '../../../lib/crm/services/pricebook-import.ts'
import { previewPriceProduct, getPriceProduct } from '../../../lib/crm/services/pricebook.ts'
import { listPriceHistory } from '../../../lib/crm/services/pricebook-history.ts'
import { buildImportDraft } from '../../../lib/crm/domain/pricebook/import-draft.ts'
import { RAW, read } from '../../../lib/crm/domain/pricebook/import-fixture.ts'
import { jsonSafe } from '../../../lib/crm/services/json-safe.ts'

loadEnv()
const WS = 'ws_test_pricebook'
const db = getCrmDb(WS)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const raw = db as any
const RUN = `i${Date.now().toString(36)}`
const MADE: string[] = []

test.before(async () => {
  await raw.crmWorkspace.upsert({ where: { id: WS }, create: { id: WS, name: 'test pricebook' }, update: {} })
})

test.after(async () => {
  if (!MADE.length) return
  await raw.crmPriceRule.deleteMany({ where: { productId: { in: MADE } } })
  const items = await raw.crmProduct.findMany({ where: { priceProductId: { in: MADE } }, select: { id: true } })
  await raw.crmAuditLog.deleteMany({ where: { targetId: { in: [...MADE, ...items.map((i: { id: string }) => i.id)] } } })
  await raw.crmProduct.deleteMany({ where: { priceProductId: { in: MADE } } })
  await raw.crmPriceProduct.deleteMany({ where: { id: { in: MADE } } })
})

function draftNamed(name: string, over = {}) {
  const r = read({ product: { name, businessType: 'SOLUTION' }, ...over })
  return jsonSafe(buildImportDraft('product', r, RAW))
}

test('★ 가져오기를 저장하면 제품 품목 규칙 예시가 생기고 미리 계산이 가격표 예시와 같다', async () => {
  const name = `import ${RUN}`
  const res = await savePriceImport(WS, null, { draft: draftNamed(name), sourceText: RAW, fileName: 'edge.xlsx' })
  assert.ok(res.productId)
  MADE.push(res.productId!)
  assert.equal(res.created, 9)
  assert.equal(res.rulesOff, 0)
  const p = await previewPriceProduct(db, res.productId!, null)
  assert.equal(p.examples[0].ok, true, p.examples[0].mismatches.join(', '))
  assert.equal(p.result.tcoMinor, BigInt(128_400_000))
  const d = await getPriceProduct(db, res.productId!)
  const std = d.items.find((i) => i.name === 'STD 기본 금액')!
  const h = await listPriceHistory(db, 'ITEM', std.id)
  assert.equal(h[0].sourceKind, 'FILE')
  assert.equal(h[0].sourceName, 'edge.xlsx')
})

test('★ 다시 올리면 바뀐 것만 고치고 없어진 품목은 판매 중지로 둔다', async () => {
  const name = `reimport ${RUN}`
  const first = await savePriceImport(WS, null, { draft: draftNamed(name), sourceText: RAW, fileName: 'v1.xlsx' })
  MADE.push(first.productId!)
  const r = read({ product: { name, businessType: 'SOLUTION' } })
  r.items = r.items.filter((i) => i.name !== '옵션 사용자 포털').map((i) => (i.name === 'STD 기본 금액' ? { ...i, price: 1300 } : i))
  const raw2 = RAW.replace('1,500', '1,300')
  const second = await savePriceImport(WS, null, { draft: jsonSafe(buildImportDraft('product', r, raw2)), sourceText: raw2, fileName: 'v2.xlsx', productId: first.productId })
  assert.equal(second.productId, first.productId, '새 제품을 만들지 않는다')
  assert.equal(second.created, 0)
  assert.equal(second.updated, 8)
  assert.equal(second.stopped, 1)
  const d = await getPriceProduct(db, first.productId!)
  const portal = d.items.find((i) => i.name === '옵션 사용자 포털')!
  assert.equal(portal.isActive, false, '지우지 않고 판매 중지')
  const std = d.items.find((i) => i.name === 'STD 기본 금액')!
  assert.equal(String(std.unitPriceMinor), '13000000')
  const h = await listPriceHistory(db, 'ITEM', std.id)
  assert.deepEqual(h.map((x) => String(x.amountMinor)), ['13000000', '15000000'], '이전 금액이 이력에 남는다')
})

test('음수 정상가는 저장 전에 막는다', async () => {
  const draft = draftNamed(`neg ${RUN}`) as { items: Record<string, unknown>[] }
  draft.items[0] = { ...draft.items[0], listPriceMinor: '-1' }
  const err = await savePriceImport(WS, null, { draft, sourceText: RAW, fileName: 'neg.xlsx' }).then(() => null, (e) => e)
  assert.match(String(err?.message), /음수/)
})

test('★ 반쯤 저장 없음 — 저장 도중 실패하면 제품도 품목도 하나도 안 남는다', async () => {
  const name = `atomic ${RUN}`
  const draft = draftNamed(name) as { rules: { rule: Record<string, unknown>; disabledReason: string | null }[] }
  // 품목을 다 쓴 뒤 규칙을 쓸 때 DB CHECK(규칙 종류 여덟)를 일부러 깬다 — 앞서 쓴 품목까지 되돌아가야 한다
  draft.rules.push({ rule: { kind: 'FORMULA', expr: '1+1' }, disabledReason: null })
  const err = await savePriceImport(WS, null, { draft, sourceText: RAW, fileName: 'bad.xlsx' }).then(() => null, (e) => e)
  assert.ok(err, '저장이 실패해야 한다')
  const left = await raw.crmPriceProduct.count({ where: { name } })
  assert.equal(left, 0, '제품이 남았다')
})
