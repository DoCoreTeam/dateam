/**
 * 견적 저장의 새 계산 — 실 DB 검증 (P0135 I14)
 *
 * ws_test_pricebook 안에 시험 전용 회사 파이프라인 딜을 만들어 그 딜에만 견적을 둔다.
 * 끝에서 만든 것을 id 로 지운다(견적은 딜을 따라 지워진다).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadEnv } from '../integrity/_helpers.ts'
import { getCrmDb } from '../../../lib/crm/db/client.ts'
import { createQuote, updateQuote, getQuote, duplicateQuote, deleteQuote } from '../../../lib/crm/services/quote.ts'
import { buildSolutionQuote } from '../../../lib/crm/domain/pricebook/solution-engine.ts'
import { GCUBE_EDGE } from '../../../lib/crm/domain/pricebook/gcube-edge.ts'
import { computeTotals } from '../../../lib/crm/domain/quote-math.ts'

loadEnv()
const WS = 'ws_test_pricebook'
const db = getCrmDb(WS)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const raw = db as any
const RUN = `q${Date.now().toString(36)}`
const MADE = { company: '', pipeline: '', deal: '', quotes: [] as string[] }

test.before(async () => {
  await raw.crmWorkspace.upsert({ where: { id: WS }, create: { id: WS, name: 'test pricebook' }, update: {} })
  const c = await raw.crmCompany.create({ data: { workspaceId: WS, name: `시험 회사 ${RUN}` }, select: { id: true } })
  const p = await raw.crmPipeline.create({ data: { workspaceId: WS, name: `시험 ${RUN}` }, select: { id: true } })
  const st = await raw.crmStage.create({ data: { pipelineId: p.id, name: '시작', position: 0 }, select: { id: true } })
  const d = await raw.crmDeal.create({ data: { workspaceId: WS, companyId: c.id, pipelineId: p.id, stageId: st.id, name: `시험 딜 ${RUN}` }, select: { id: true } })
  Object.assign(MADE, { company: c.id, pipeline: p.id, deal: d.id })
})

test.after(async () => {
  if (MADE.quotes.length) await raw.crmAuditLog.deleteMany({ where: { targetId: { in: MADE.quotes } } })
  if (MADE.deal) await raw.crmDeal.deleteMany({ where: { id: MADE.deal } })
  if (MADE.pipeline) {
    await raw.crmStage.deleteMany({ where: { pipelineId: MADE.pipeline } })
    await raw.crmPipeline.deleteMany({ where: { id: MADE.pipeline } })
  }
  if (MADE.company) await raw.crmCompany.deleteMany({ where: { id: MADE.company } })
})

function edgeLines() {
  const s = buildSolutionQuote(GCUBE_EDGE, GCUBE_EDGE.examples![0].conditions)
  const names = GCUBE_EDGE.sections.map((x) => x.name)
  return s.lines.map((l) => ({
    name: l.name, quantity: l.quantity, unit: l.unit, unitPriceMinor: String(l.unitPriceMinor),
    discountPercent: Number(l.discountPercent ?? 0), taxRate: l.taxRate, sectionIndex: names.indexOf(String(l.sectionKey)),
    listPriceMinor: l.listPriceMinor === null ? null : String(l.listPriceMinor), priceSource: 'LIST',
    provenance: l.provenance, billing: l.billing, ratioPct: l.ratioPct, ratioOfSectionName: l.ratioOfSectionKey,
  }))
}

test('★ 제품으로 채운 견적을 저장하면 1회 84,000,000(+부가세), 매년 11,100,000 이 따로 남는다', async () => {
  const q = await createQuote(WS, null, {
    dealId: MADE.deal, title: `edge ${RUN}`, sections: GCUBE_EDGE.sections.map((x) => ({ name: x.name, roundingUnit: x.roundingUnit })),
    lines: edgeLines(), autoFilled: [{ field: '노드 수', value: '20대', provenance: { source: 'DEFAULT' } }],
  })
  MADE.quotes.push(q.id)
  const full = await getQuote(db, q.id)
  assert.equal(String(full.totalMinor), '92400000')
  assert.equal(String((full as unknown as { annualMinor: bigint }).annualMinor), '11100000')
  const maint = full.lines!.find((l) => l.name === '유지보수 표준')!
  assert.equal(String(maint.lineTotalMinor), '11100000', '비율 줄의 합계가 저장된다')
  assert.equal(maint.billing, 'ANNUAL')
  assert.equal(full.approvalRequired, false)
  assert.equal(full.lines!.find((l) => l.name === 'STD 기본 금액')!.priceSource, 'LIST')
  // ★ 딜의 견적 금액 = 대표 견적의 1회분 공급가액. 매년분과 부가세는 안 섞인다(I8)
  const deal = await raw.crmDeal.findFirst({ where: { id: MADE.deal }, select: { quotedNetMinor: true } })
  assert.equal(String(deal.quotedNetMinor), '84000000')
  const hist = await raw.crmDealAmountHistory.findFirst({ where: { dealId: MADE.deal, field: 'quoted' }, orderBy: { changedAt: 'desc' }, select: { toMinor: true, sourceQuoteId: true } })
  assert.equal(String(hist.toMinor), '84000000')
  assert.equal(hist.sourceQuoteId, q.id)
})

test('견적을 지우면 딜의 견적 금액이 다음 대표 견적으로, 없으면 비운다', async () => {
  const d = await raw.crmDeal.create({ data: { workspaceId: WS, companyId: MADE.company, pipelineId: MADE.pipeline, stageId: (await raw.crmStage.findFirst({ where: { pipelineId: MADE.pipeline }, select: { id: true } })).id, name: `빈 딜 ${RUN}` }, select: { id: true } })
  try {
    const q = await createQuote(WS, null, { dealId: d.id, title: `one ${RUN}`, lines: [{ name: 'A', quantity: 1, unitPriceMinor: '1000000', taxRate: 10 }] })
    MADE.quotes.push(q.id)
    assert.equal(String((await raw.crmDeal.findFirst({ where: { id: d.id }, select: { quotedNetMinor: true } })).quotedNetMinor), '1000000')
    await deleteQuote(WS, null, q.id, 'trash')
    assert.equal((await raw.crmDeal.findFirst({ where: { id: d.id }, select: { quotedNetMinor: true } })).quotedNetMinor, null)
  } finally {
    await raw.crmDeal.deleteMany({ where: { id: d.id } })
  }
})

test('★ 정상가보다 단가를 깎아 저장하면 정상가 대비로 승인이 걸린다', async () => {
  const lines = edgeLines().map((l) => (l.name === 'GPU 라이선스 데이터센터용' ? { ...l, unitPriceMinor: '3000000' } : l))
  const q = await createQuote(WS, null, { dealId: MADE.deal, title: `cut ${RUN}`, sections: GCUBE_EDGE.sections.map((x) => ({ name: x.name, roundingUnit: x.roundingUnit })), lines })
  MADE.quotes.push(q.id)
  assert.equal(q.approvalRequired, true, '할인 칸은 0 이지만 정상가 대비 23% 깎음')
})

test('★ 새 칸이 없는 견적은 예전 계산 그대로다 — computeTotals 와 1원도 안 다르다', async () => {
  const lines = [
    { name: '서버', quantity: 2, unitPriceMinor: '17600000', discountPercent: 5, taxRate: 10 },
    { name: '구축', quantity: 1, unitPriceMinor: '3333333', taxRate: 10 },
  ]
  const q = await createQuote(WS, null, { dealId: MADE.deal, title: `legacy ${RUN}`, lines, roundingUnit: 10_000 })
  MADE.quotes.push(q.id)
  const t = computeTotals(lines, { unit: 10_000, mode: 'DOWN' })
  assert.equal(String(q.totalMinor), String(t.totalMinor))
  assert.equal(String((q as unknown as { annualMinor: bigint }).annualMinor), '0')
  // 절사만 바꾸는 저장도 옛 길이다
  const after = await updateQuote(WS, null, q.id, { version: q.version, roundingUnit: 100_000 })
  assert.equal(String(after.totalMinor), String(computeTotals(lines, { unit: 100_000, mode: 'DOWN' }).totalMinor))
})

test('★ 개정본은 가격 기준 칸과 묶음 절사를 들고 가고 항목마다 앞 항목을 가리킨다', async () => {
  const q = await createQuote(WS, null, { dealId: MADE.deal, title: `dup ${RUN}`, sections: GCUBE_EDGE.sections.map((x) => ({ name: x.name, roundingUnit: x.roundingUnit })), lines: edgeLines() })
  MADE.quotes.push(q.id)
  const rev = await duplicateQuote(WS, null, q.id, { mode: 'revision' })
  MADE.quotes.push(rev.id)
  const a = await getQuote(db, q.id)
  const b = await getQuote(db, rev.id)
  assert.equal(String(b.totalMinor), String(a.totalMinor))
  assert.equal(String((b as unknown as { annualMinor: bigint }).annualMinor), '11100000')
  assert.equal(b.sections![0].roundingUnit, 10_000)
  for (const l of b.lines!) {
    const src = a.lines!.find((x) => x.id === l.sourceLineId)
    assert.ok(src, `${l.name} 이 앞 항목을 가리키지 않는다`)
    assert.equal(String(l.listPriceMinor), String(src!.listPriceMinor))
  }
})
