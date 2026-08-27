/**
 * 매출 인식 장부 — 서비스 계약
 *
 * 여기서 지키는 것은 셋이다:
 *   ① 화면이 받는 숫자가 **서버에서 계산돼** 나간다 (화면이 뺄셈을 안 한다)
 *   ② 현물이 사업비를 넘으면 **저장 자체를 막는다** (I9)
 *   ③ 원가를 역산할 수 있는 값은 권한이 없으면 **응답에서 빠진다** (가리는 게 아니라)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getLedger, recalcLedger, addInKind, removeInKind, setFunding, toLedgerJson,
  IN_KIND_LABEL, IN_KIND_BASIS_HINT,
} from './ledger.ts'
import type { CrmDb } from '../db/client.ts'
import type { FundingSourceType } from '../domain/booked-amount.ts'

const 억 = (n: number) => BigInt(n) * BigInt(100_000_000)

interface Rows {
  deal: Record<string, unknown>
  funding: Record<string, unknown>[]
  inKind: Record<string, unknown>[]
}

/** 최소한의 가짜 DB — 실제 Prisma 대신 이 서비스가 부르는 것만 흉내낸다 */
function fakeDb(rows: Rows) {
  const log: { updated?: Record<string, unknown>; history: Record<string, unknown>[] } = { history: [] }
  const db = {
    crmDeal: {
      findFirst: async () => rows.deal,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(rows.deal, data); log.updated = data; return rows.deal
      },
    },
    crmFundingSource: {
      findMany: async () => rows.funding,
      deleteMany: async () => { rows.funding = []; return { count: 0 } },
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        rows.funding = data.map((d, i) => ({ id: `f${i}`, ...d })); return { count: data.length }
      },
    },
    crmInKind: {
      findMany: async () => rows.inKind,
      findFirst: async () => rows.inKind[rows.inKind.length - 1] ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        rows.inKind.push({ id: `k${rows.inKind.length}`, ...data }); return data
      },
      update: async () => rows.inKind[0],
      delete: async () => { rows.inKind.pop(); return {} },
    },
    crmDealAmountHistory: {
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        log.history.push(...data); return { count: data.length }
      },
    },
  }
  return { db: db as unknown as CrmDb, log, rows }
}

function baseDeal(over: Record<string, unknown> = {}) {
  return {
    id: 'd1', workspaceId: 'ws', taxBasis: 'GROSS', taxRatePct: '10',
    budgetNetMinor: null, quotedNetMinor: null, contractNetMinor: 억(13),
    bookedNetMinor: 억(13), inKindTotalMinor: BigInt(0), ...over,
  }
}

test('세 숫자를 서버가 계산해 보낸다 — 화면은 뺄셈을 하지 않는다', async () => {
  const { db } = fakeDb({
    deal: baseDeal(),
    funding: [
      { id: 'f1', sourceType: 'NATIONAL', amountMinor: 억(9), agencyName: '과기정통부', startDate: null, endDate: null, position: 0 },
      { id: 'f2', sourceType: 'OWN_CASH', amountMinor: BigInt(140_000_000), agencyName: null, startDate: null, endDate: null, position: 1 },
      { id: 'f3', sourceType: 'IN_KIND', amountMinor: BigInt(260_000_000), agencyName: null, startDate: null, endDate: null, position: 2 },
    ],
    inKind: [{ id: 'k1', kind: 'LABOR', name: '연구원 3명', valueMinor: BigInt(260_000_000), quantity: null, unit: null, basisNote: null, startDate: null, endDate: null, position: 0 }],
  })
  const l = await getLedger(db, 'd1')

  assert.equal(l.bookedMinor, 억(13))
  assert.equal(l.inKindMinor, BigInt(260_000_000))
  assert.equal(l.exInKindMinor, BigInt(1_040_000_000), '현물 제외 = 13억 − 2.6억')
  assert.equal(l.accountingRevenueMinor, 억(9), '회계 수익은 국비만 — 자부담 현금은 빠진다')
  assert.equal(l.cashInflowMinor, BigInt(1_040_000_000), '현금 유입은 현물만 빠진다')
  assert.equal(l.bookedFrom, 'contract')
})

test('★ 포함가에 세율을 곱하지 않는다 — 13억 GROSS 의 세액은 1억1,818만이다', async () => {
  const { db } = fakeDb({ deal: baseDeal(), funding: [], inKind: [] })
  const l = await getLedger(db, 'd1')
  assert.equal(l.tax.netMinor, BigInt(1_181_818_182))
  assert.equal(l.tax.taxMinor, BigInt(118_181_818))
  assert.equal(l.tax.grossMinor, 억(13), '합계는 원본 그대로여야 한다')
  assert.equal(l.tax.netMinor + l.tax.taxMinor, l.tax.grossMinor, 'I5')
})

test('재원 성질은 종류에서 파생된다 — 행마다 손으로 넣지 않는다', async () => {
  const { db } = fakeDb({
    deal: baseDeal(),
    funding: [
      { id: 'f1', sourceType: 'OWN_CASH', amountMinor: 억(1), agencyName: null, startDate: null, endDate: null, position: 0 },
      { id: 'f2', sourceType: 'IN_KIND', amountMinor: 억(1), agencyName: null, startDate: null, endDate: null, position: 1 },
    ],
    inKind: [],
  })
  const l = await getLedger(db, 'd1')
  assert.equal(l.funding[0].needsSeparateAccount, true, '자부담 현금은 법령상 별도 계좌')
  assert.equal(l.funding[0].isCashInflow, true)
  assert.equal(l.funding[0].countsAsAccountingRevenue, false)
  assert.equal(l.funding[1].isCashInflow, false, '현물은 돈이 안 움직인다')
  assert.equal(l.funding[1].label, IN_KIND_LABEL.LABOR === '인건비' ? '자부담 현물' : '자부담 현물')
})

test('★ 현물이 수주 매출을 넘으면 저장을 막는다 (I9)', async () => {
  const { db } = fakeDb({
    deal: baseDeal({ contractNetMinor: 억(1), bookedNetMinor: 억(1) }),
    funding: [],
    inKind: [{ id: 'k1', kind: 'LABOR', name: '과다', valueMinor: 억(2), quantity: null, unit: null, basisNote: null, startDate: null, endDate: null, position: 0 }],
  })
  await assert.rejects(() => recalcLedger(db, 'd1'), /현물 합계가 수주 매출을 넘습니다/)
})

test('파생값이 바뀌면 이유를 남긴다 — 파이프라인 총액이 출렁인 까닭을 설명할 수 있어야 한다', async () => {
  const { db, log } = fakeDb({
    deal: baseDeal({ inKindTotalMinor: BigInt(0) }),
    funding: [],
    inKind: [{ id: 'k1', kind: 'LABOR', name: '연구원', valueMinor: 억(2), quantity: null, unit: null, basisNote: null, startDate: null, endDate: null, position: 0 }],
  })
  await recalcLedger(db, 'd1', 'm1')
  assert.equal(log.updated?.inKindTotalMinor, 억(2))
  assert.equal(log.history.length, 1)
  assert.equal(log.history[0].field, 'inKind')
})

test('바뀐 게 없으면 이력을 남기지 않는다 — 열어보기만 해도 로그가 쌓이면 안 된다', async () => {
  const { db, log } = fakeDb({
    deal: baseDeal({ inKindTotalMinor: 억(2), bookedNetMinor: 억(13) }),
    funding: [],
    inKind: [{ id: 'k1', kind: 'LABOR', name: '연구원', valueMinor: 억(2), quantity: null, unit: null, basisNote: null, startDate: null, endDate: null, position: 0 }],
  })
  await recalcLedger(db, 'd1', 'm1')
  assert.equal(log.history.length, 0)
})

test('현물 이름이 비면 저장하지 않는다', async () => {
  const { db } = fakeDb({ deal: baseDeal(), funding: [], inKind: [] })
  await assert.rejects(
    () => addInKind(db, 'ws', 'd1', { kind: 'LABOR', name: '   ', valueMinor: 억(1) }),
    /현물 이름을 입력해 주세요/,
  )
})

test('환산 근거를 안 적으면 종류에 맞는 기본 문구가 들어간다 — 빈칸으로 두지 않는다', async () => {
  const f = fakeDb({ deal: baseDeal(), funding: [], inKind: [] })
  await addInKind(f.db, 'ws', 'd1', { kind: 'LABOR', name: '연구원 3명', valueMinor: 억(2) })
  assert.equal(f.rows.inKind[0].basisNote, IN_KIND_BASIS_HINT.LABOR)
})

test('종료일이 시작일보다 앞서면 거부한다', async () => {
  const { db } = fakeDb({ deal: baseDeal(), funding: [], inKind: [] })
  await assert.rejects(
    () => addInKind(db, 'ws', 'd1', { kind: 'LABOR', name: 'x', valueMinor: 억(1), startDate: '2027-03-01', endDate: '2026-03-01' }),
    /종료일이 시작일보다 앞섭니다/,
  )
})

test('같은 재원 종류가 두 번 오면 거부한다 — 종류마다 한 줄이다', async () => {
  const { db } = fakeDb({ deal: baseDeal(), funding: [], inKind: [] })
  await assert.rejects(
    () => setFunding(db, 'ws', 'd1', [
      { sourceType: 'NATIONAL', amountMinor: 억(5) },
      { sourceType: 'NATIONAL', amountMinor: 억(4) },
    ]),
    /두 번 들어왔습니다/,
  )
})

test('★ 현물 명세는 권한이 없으면 응답에서 빠진다 — 가리는 게 아니라 뺀다', async () => {
  const { db } = fakeDb({
    deal: baseDeal(),
    funding: [],
    inKind: [{ id: 'k1', kind: 'LABOR', name: '연구원 3명 × 참여율 50%', valueMinor: BigInt(260_000_000), quantity: null, unit: null, basisNote: '연봉 × 참여율 × 기간', startDate: null, endDate: null, position: 0 }],
  })
  const l = await getLedger(db, 'd1')

  const member = toLedgerJson(l, { role: 'MEMBER' })
  assert.equal(member.inKind, null, '명세는 안 온다')
  assert.equal(member.inKindMinor, '260000000', '합계는 온다 — 합계로는 단가를 역산할 수 없다')
  assert.equal(member.inKindCount, 1, '몇 건인지는 알려 준다')
  assert.equal(JSON.stringify(member).includes('참여율'), false, '명세 문구가 전선을 타고 나가지 않는다')

  const admin = toLedgerJson(l, { role: 'ADMIN' })
  assert.equal(Array.isArray(admin.inKind), true)
})

test('능력을 개별 부여하면 역할과 무관하게 명세를 본다 — 나중에 푸는 길', async () => {
  const { db } = fakeDb({
    deal: baseDeal(), funding: [],
    inKind: [{ id: 'k1', kind: 'LABOR', name: 'x', valueMinor: 억(1), quantity: null, unit: null, basisNote: null, startDate: null, endDate: null, position: 0 }],
  })
  const l = await getLedger(db, 'd1')
  const json = toLedgerJson(l, { role: 'MEMBER', capabilities: ['cost.view'] })
  assert.equal(Array.isArray(json.inKind), true)
})

test('현물이 없으면 화면이 «현물 제외»를 그리지 않는다', async () => {
  const { db } = fakeDb({ deal: baseDeal(), funding: [], inKind: [] })
  const json = toLedgerJson(await getLedger(db, 'd1'), { role: 'ADMIN' })
  assert.equal(json.hasInKind, false)
  assert.equal(json.inKindRatioPct, null)
})

test('재원이 없으면 회계 수익은 null — «모른다»와 «0»은 다르다', async () => {
  const { db } = fakeDb({ deal: baseDeal(), funding: [], inKind: [] })
  const json = toLedgerJson(await getLedger(db, 'd1'), { role: 'ADMIN' })
  assert.equal(json.accountingRevenueMinor, null)
  assert.equal(json.cashInflowMinor, null)
})

test('연차 배분은 기간에서 계산한다 — 기간 없는 현물은 0으로 때우지 않는다', async () => {
  const { db } = fakeDb({
    deal: baseDeal(),
    funding: [],
    inKind: [
      { id: 'k1', kind: 'LABOR', name: '기간 있음', valueMinor: BigInt(180_000_000), quantity: null, unit: null, basisNote: null, startDate: new Date('2026-03-01'), endDate: new Date('2028-02-29'), position: 0 },
      { id: 'k2', kind: 'MATERIAL', name: '기간 없음', valueMinor: BigInt(20_000_000), quantity: null, unit: null, basisNote: null, startDate: null, endDate: null, position: 1 },
    ],
  })
  const json = toLedgerJson(await getLedger(db, 'd1'), { role: 'ADMIN' })
  assert.deepEqual(json.inKindByYear, [
    { year: 2026, months: 10, amountMinor: '75000000' },
    { year: 2027, months: 12, amountMinor: '90000000' },
    { year: 2028, months: 2, amountMinor: '15000000' },
  ])
  assert.equal(json.inKindUndatedMinor, '20000000', '기간 없는 것은 따로 센다')
})

test('BigInt 는 문자열로 나간다 — JSON 은 BigInt 를 못 싣는다', async () => {
  const { db } = fakeDb({ deal: baseDeal(), funding: [], inKind: [] })
  const json = toLedgerJson(await getLedger(db, 'd1'), { role: 'ADMIN' })
  assert.doesNotThrow(() => JSON.stringify(json))
  assert.equal(typeof json.bookedMinor, 'string')
})

test('★ 넘치는 현물은 **저장되기 전에** 막힌다 — 저장 뒤에 검사하면 잘못된 행이 남는다', async () => {
  // 실브라우저에서 잡았다: 20억 현물이 저장된 뒤 검사가 던져서
  // 오류는 떴지만 행은 남았고, 화면이 「현물 제외 −9.6억」을 그렸다.
  const f = fakeDb({
    deal: baseDeal({ contractNetMinor: 억(13), bookedNetMinor: 억(13) }),
    funding: [],
    inKind: [],
  })
  await assert.rejects(
    () => addInKind(f.db, 'ws', 'd1', { kind: 'LABOR', name: '과다 현물', valueMinor: 억(20) }),
    /현물 합계가 수주 매출을 넘습니다/,
  )
  assert.equal(f.rows.inKind.length, 0, '막혔으면 행이 남아서는 안 된다')
})

test('이미 있는 현물과 합쳐서 넘치면 그것도 막는다 — 한 줄씩은 작아도 합이 넘는다', async () => {
  const f = fakeDb({
    deal: baseDeal({ contractNetMinor: 억(13), bookedNetMinor: 억(13) }),
    funding: [],
    inKind: [{ id: 'k1', kind: 'LABOR', name: '기존', valueMinor: 억(10), quantity: null, unit: null, basisNote: null, startDate: null, endDate: null, position: 0 }],
  })
  await assert.rejects(
    () => addInKind(f.db, 'ws', 'd1', { kind: 'MATERIAL', name: '추가', valueMinor: 억(5) }),
    /현물 합계가 수주 매출을 넘습니다/,
  )
  assert.equal(f.rows.inKind.length, 1, '기존 한 줄만 남는다')
})

test('딱 맞으면 통과한다 — 과하게 막으면 정상 입력이 안 된다', async () => {
  const f = fakeDb({
    deal: baseDeal({ contractNetMinor: 억(13), bookedNetMinor: 억(13) }),
    funding: [],
    inKind: [],
  })
  await addInKind(f.db, 'ws', 'd1', { kind: 'LABOR', name: '딱 13억', valueMinor: 억(13) })
  assert.equal(f.rows.inKind.length, 1)
})

// ────────────────────────────────────────────────────────────────────
// 복합 상황 — 한 가지 딜로 「됐다」고 하지 않는다.
// 실제 영업에 섞여 들어오는 조합을 하나씩 세운다.
// ────────────────────────────────────────────────────────────────────

/** 시나리오를 세우는 도구 — 조합마다 손으로 객체를 쓰면 빠뜨린다 */
function scenario(over: {
  deal?: Record<string, unknown>
  funding?: [FundingSourceType, bigint][]
  inKind?: [InKindKind, string, bigint, (string | null)?, (string | null)?][]
} = {}) {
  return fakeDb({
    deal: baseDeal(over.deal ?? {}),
    funding: (over.funding ?? []).map(([sourceType, amountMinor], i) => ({
      id: `f${i}`, sourceType, amountMinor, agencyName: null,
      startDate: null, endDate: null, position: i,
    })),
    inKind: (over.inKind ?? []).map(([kind, name, valueMinor, s, e], i) => ({
      id: `k${i}`, kind, name, valueMinor, quantity: null, unit: null, basisNote: null,
      startDate: s ? new Date(s) : null, endDate: e ? new Date(e) : null, position: i,
    })),
  })
}

test('조합 ① 국가 과제 — GROSS · 재원 넷 · 현물 여러 줄', async () => {
  const { db } = scenario({
    deal: { taxBasis: 'GROSS', contractNetMinor: 억(20), bookedNetMinor: 억(20) },
    funding: [['NATIONAL', 억(12)], ['LOCAL', 억(3)], ['OWN_CASH', 억(1)], ['IN_KIND', 억(4)]],
    inKind: [['LABOR', '연구원', 억(3)], ['EQUIPMENT', 'GPU 서버', 억(1)]],
  })
  const l = await getLedger(db, 'd1')
  assert.equal(l.bookedMinor, 억(20))
  assert.equal(l.inKindMinor, 억(4), '명세 두 줄의 합')
  assert.equal(l.exInKindMinor, 억(16))
  assert.equal(l.accountingRevenueMinor, 억(15), '국비 12 + 지방비 3')
  assert.equal(l.cashInflowMinor, 억(16), '현물만 빠진다')
  assert.equal(l.tax.grossMinor, 억(20), 'GROSS 는 원본이 총액')
  assert.equal(l.tax.netMinor + l.tax.taxMinor, 억(20), 'I5')
})

test('조합 ② 평범한 딜 — NET · 재원 없음 · 현물 없음', async () => {
  const { db } = scenario({ deal: { taxBasis: 'NET', contractNetMinor: 억(1), bookedNetMinor: 억(1) } })
  const l = await getLedger(db, 'd1')
  assert.equal(l.hasInKind, false, '화면이 「현물 제외」를 아예 안 그린다')
  assert.equal(l.accountingRevenueMinor, null, '재원이 없으면 «모른다»')
  assert.equal(l.tax.netMinor, 억(1), 'NET 은 원본이 공급가액')
  assert.equal(l.tax.taxMinor, BigInt(10_000_000))
})

test('조합 ③ 현물만 있고 재원은 안 쓴다 — 국가 과제가 아닌 협업', async () => {
  const { db } = scenario({
    deal: { contractNetMinor: 억(5), bookedNetMinor: 억(5) },
    inKind: [['FACILITY', '실험실', 억(1)]],
  })
  const l = await getLedger(db, 'd1')
  assert.equal(l.exInKindMinor, 억(4))
  assert.equal(l.accountingRevenueMinor, null, '재원을 안 썼으면 회계 수익도 «모른다»')
  assert.equal(l.inKindRatioPct, 20)
})

test('조합 ④ 재원만 있고 현물은 없다 — 전액 현금 과제', async () => {
  const { db } = scenario({
    deal: { contractNetMinor: 억(10), bookedNetMinor: 억(10) },
    funding: [['NATIONAL', 억(8)], ['OWN_CASH', 억(2)]],
  })
  const l = await getLedger(db, 'd1')
  assert.equal(l.hasInKind, false)
  assert.equal(l.exInKindMinor, 억(10), '뺄 현물이 없으면 수주 매출과 같다')
  assert.equal(l.cashInflowMinor, 억(10), '현물이 없으니 전액 현금')
})

test('조합 ⑤ 셋 다 있으면 계약이 이긴다 — 예산·견적은 지나온 자리다', async () => {
  const { db } = scenario({
    deal: { budgetNetMinor: 억(8), quotedNetMinor: 억(9), contractNetMinor: 억(10), bookedNetMinor: 억(10) },
  })
  const l = await getLedger(db, 'd1')
  assert.equal(l.bookedFrom, 'contract')
  assert.equal(l.bookedMinor, 억(10))
})

test('조합 ⑥ 계약 전이면 견적, 견적 전이면 예산', async () => {
  const q = await getLedger(scenario({ deal: { budgetNetMinor: 억(8), quotedNetMinor: 억(9), contractNetMinor: null } }).db, 'd1')
  assert.equal(q.bookedFrom, 'quote')
  const b = await getLedger(scenario({ deal: { budgetNetMinor: 억(8), quotedNetMinor: null, contractNetMinor: null } }).db, 'd1')
  assert.equal(b.bookedFrom, 'budget')
})

test('조합 ⑦ 금액이 아예 없는 딜 — 0원이라고 말하지 않고 「금액 미정」이라 말한다', async () => {
  const { db } = scenario({
    deal: { budgetNetMinor: null, quotedNetMinor: null, contractNetMinor: null, bookedNetMinor: null, amountMinor: null },
  })
  const json = toLedgerJson(await getLedger(db, 'd1'), { role: 'ADMIN' })
  assert.equal(json.bookedFrom, 'none')
  assert.equal(json.bookedFromLabel, '금액 미정')
  assert.equal(json.bookedMinor, '0')
})

test('조합 ⑧ 세율 0% — 세액 0이고 공급가액과 합계가 같다', async () => {
  const { db } = scenario({ deal: { taxRatePct: '0', contractNetMinor: 억(3), bookedNetMinor: 억(3) } })
  const l = await getLedger(db, 'd1')
  assert.equal(l.tax.taxMinor, BigInt(0))
  assert.equal(l.tax.netMinor, l.tax.grossMinor)
})

test('조합 ⑨ 현물이 수주 매출과 **딱 같다** — 경계에서 막지 않는다', async () => {
  const { db } = scenario({
    deal: { contractNetMinor: 억(2), bookedNetMinor: 억(2) },
    inKind: [['LABOR', '전액 현물', 억(2)]],
  })
  const l = await getLedger(db, 'd1')
  assert.equal(l.exInKindMinor, BigInt(0), '현물 제외가 0원인 것은 정상이다')
  assert.equal(l.inKindRatioPct, 100)
  await assert.doesNotReject(() => recalcLedger(db, 'd1'))
})

test('조합 ⑩ 현물이 1원 넘으면 막는다 — 경계 바로 밖', async () => {
  const { db } = scenario({
    deal: { contractNetMinor: 억(2), bookedNetMinor: 억(2) },
    inKind: [['LABOR', '1원 초과', 억(2) + BigInt(1)]],
  })
  await assert.rejects(() => recalcLedger(db, 'd1'), /1원 초과/)
})

test('조합 ⑪ 현물 여러 줄 · 기간 있는 것과 없는 것이 섞인다', async () => {
  const { db } = scenario({
    deal: { contractNetMinor: 억(10), bookedNetMinor: 억(10) },
    inKind: [
      ['LABOR', '2년 인건비', BigInt(180_000_000), '2026-03-01', '2028-02-29'],
      ['MATERIAL', '기간 미정 재료', BigInt(20_000_000)],
      ['FACILITY', '1년 시설', BigInt(120_000_000), '2026-01-01', '2026-12-31'],
    ],
  })
  const json = toLedgerJson(await getLedger(db, 'd1'), { role: 'ADMIN' })
  assert.equal(json.inKindMinor, '320000000')
  assert.equal(json.inKindUndatedMinor, '20000000', '기간 없는 것만 따로')
  const years = json.inKindByYear as { year: number; amountMinor: string }[]
  const sum = years.reduce((a, y) => a + BigInt(y.amountMinor), BigInt(0))
  assert.equal(sum + BigInt(json.inKindUndatedMinor as string), BigInt('320000000'), '배분해도 1원도 안 사라진다')
  assert.deepEqual(years.map((y) => y.year), [2026, 2027, 2028])
})

test('조합 ⑫ 회계 수익이 0인 경우 — 자부담만으로 하는 과제', async () => {
  const { db } = scenario({
    deal: { contractNetMinor: 억(3), bookedNetMinor: 억(3) },
    funding: [['OWN_CASH', 억(2)], ['IN_KIND', 억(1)]],
    inKind: [['LABOR', '인력', 억(1)]],
  })
  const l = await getLedger(db, 'd1')
  assert.equal(l.accountingRevenueMinor, BigInt(0), '국비·지방비가 없으면 0 — null 이 아니다')
  assert.notEqual(l.accountingRevenueMinor, null, '재원을 썼으므로 «모른다»가 아니다')
  assert.equal(l.cashInflowMinor, 억(2))
})

test('조합 ⑬ 재원 합이 수주 매출과 안 맞아도 막지 않는다 — 입력 중인 상태다', async () => {
  // 재원은 합이 맞아야 뜻이 있지만, 입력하다 만 상태를 저장 못 하게 하면 아무것도 못 넣는다
  const { db } = scenario({
    deal: { contractNetMinor: 억(10), bookedNetMinor: 억(10) },
    funding: [['NATIONAL', 억(3)]],
  })
  const l = await getLedger(db, 'd1')
  assert.equal(l.bookedMinor, 억(10))
  assert.equal(l.accountingRevenueMinor, 억(3), '합이 안 맞아도 있는 그대로 보여 준다')
})

test('조합 ⑭ 권한 — 같은 장부를 네 역할이 다르게 본다', async () => {
  const { db } = scenario({
    deal: { contractNetMinor: 억(10), bookedNetMinor: 억(10) },
    inKind: [['LABOR', '연구원 3명 × 참여율 50%', 억(2)]],
  })
  const l = await getLedger(db, 'd1')
  for (const role of ['OWNER', 'ADMIN']) {
    const j = toLedgerJson(l, { role })
    assert.equal(Array.isArray(j.inKind), true, `${role} 는 명세를 본다`)
    assert.equal(j.canEdit, true, `${role} 는 고칠 수 있다`)
  }
  for (const role of ['MEMBER', 'READONLY']) {
    const j = toLedgerJson(l, { role })
    assert.equal(j.inKind, null, `${role} 는 명세를 못 본다`)
    assert.equal(j.canEdit, false, `${role} 는 못 고친다`)
    assert.equal(j.inKindMinor, '200000000', '그래도 합계는 본다')
    assert.equal(JSON.stringify(j).includes('참여율'), false, '명세 문구가 안 새어 나간다')
  }
  assert.equal(toLedgerJson(l, null).inKind, null, '로그인 안 했으면 아무것도 못 본다')
})

test('조합 ⑮ 재원 갈아 끼우기 — 통째로 바꾸고 남는 줄이 없다', async () => {
  const f = scenario({
    deal: { contractNetMinor: 억(10), bookedNetMinor: 억(10) },
    funding: [['NATIONAL', 억(5)], ['LOCAL', 억(5)]],
  })
  await setFunding(f.db, 'ws', 'd1', [{ sourceType: 'NATIONAL', amountMinor: 억(7) }])
  assert.equal(f.rows.funding.length, 1, '옛 줄이 남으면 합이 두 배가 된다')
  assert.equal((f.rows.funding[0] as { sourceType: string }).sourceType, 'NATIONAL')
})

test('조합 ⑯ 재원을 통째로 비운다 — 「안 쓰는 딜」로 되돌아간다', async () => {
  const f = scenario({
    deal: { contractNetMinor: 억(10), bookedNetMinor: 억(10) },
    funding: [['NATIONAL', 억(5)]],
  })
  const l = await setFunding(f.db, 'ws', 'd1', [])
  assert.equal(l.accountingRevenueMinor, null, '비우면 0 이 아니라 «모른다»로 돌아간다')
})

test('조합 ⑰ 금액 문자열에 콤마가 섞여 와도 받는다 — 사람이 치는 그대로', async () => {
  const f = scenario({ deal: { contractNetMinor: 억(10), bookedNetMinor: 억(10) } })
  await addInKind(f.db, 'ws', 'd1', { kind: 'LABOR', name: '콤마', valueMinor: '1,500,000' })
  assert.equal((f.rows.inKind[0] as { valueMinor: bigint }).valueMinor, BigInt(1_500_000))
})

test('조합 ⑱ 음수 금액은 거부한다 — 현물이 마이너스일 수는 없다', async () => {
  const f = scenario({ deal: { contractNetMinor: 억(10), bookedNetMinor: 억(10) } })
  await assert.rejects(
    () => addInKind(f.db, 'ws', 'd1', { kind: 'LABOR', name: '음수', valueMinor: -1 }),
    /0보다 작을 수 없습니다/,
  )
})

test('조합 ⑲ 숫자가 아닌 금액은 거부한다 — 쓰레기 문자열', async () => {
  const f = scenario({ deal: { contractNetMinor: 억(10), bookedNetMinor: 억(10) } })
  await assert.rejects(
    () => addInKind(f.db, 'ws', 'd1', { kind: 'LABOR', name: '쓰레기', valueMinor: '있는대로' }),
    /숫자가 아닙니다/,
  )
})

test('조합 ⑳ 없는 딜·없는 현물 — 조용히 성공하지 않는다', async () => {
  const empty = {
    crmDeal: { findFirst: async () => null },
    crmInKind: { findFirst: async () => null, findMany: async () => [] },
    crmFundingSource: { findMany: async () => [] },
  } as unknown as CrmDb
  await assert.rejects(() => getLedger(empty, 'nope'), /딜을 찾을 수 없습니다/)
  await assert.rejects(() => removeInKind(empty, 'd1', 'nope'), /현물 항목을 찾을 수 없습니다/)
})

test('조합 ㉑ 기간이 하루짜리여도 배분된다 — 한 달로 센다', async () => {
  const { db } = scenario({
    deal: { contractNetMinor: 억(10), bookedNetMinor: 억(10) },
    inKind: [['MATERIAL', '하루', BigInt(1_000_000), '2026-05-10', '2026-05-10']],
  })
  const json = toLedgerJson(await getLedger(db, 'd1'), { role: 'ADMIN' })
  assert.deepEqual(json.inKindByYear, [{ year: 2026, months: 1, amountMinor: '1000000' }])
})

test('조합 ㉒ 연말·연초를 걸치는 기간 — 해가 갈린다', async () => {
  const { db } = scenario({
    deal: { contractNetMinor: 억(10), bookedNetMinor: 억(10) },
    inKind: [['LABOR', '연말연초', BigInt(4_000_000), '2026-11-01', '2027-02-28']],
  })
  const json = toLedgerJson(await getLedger(db, 'd1'), { role: 'ADMIN' })
  const years = json.inKindByYear as { year: number; months: number; amountMinor: string }[]
  assert.deepEqual(years.map((y) => [y.year, y.months]), [[2026, 2], [2027, 2]])
  assert.equal(
    years.reduce((a, y) => a + BigInt(y.amountMinor), BigInt(0)),
    BigInt(4_000_000),
  )
})

test('조합 ㉓ 통화가 원이 아닌 딜 — 장부가 딜 통화를 함께 보낸다', async () => {
  // 실브라우저에서 잡았다: USD 딜인데 장부가 「120,000,000원」이라고 말했다.
  const { db } = fakeDb({
    deal: { ...baseDeal({ contractNetMinor: BigInt(120_000_000) }), currency: 'USD' },
    funding: [], inKind: [],
  })
  const json = toLedgerJson(await getLedger(db, 'd1'), { role: 'ADMIN' })
  assert.equal(json.currency, 'USD', '화면이 「원」을 붙이지 않으려면 통화가 와야 한다')
})

test('조합 ㉔ 통화가 비어 있으면 null — 화면이 기본값을 정한다', async () => {
  const { db } = fakeDb({ deal: { ...baseDeal(), currency: null }, funding: [], inKind: [] })
  const json = toLedgerJson(await getLedger(db, 'd1'), { role: 'ADMIN' })
  assert.equal(json.currency, null)
})

test('조합 ㉕ 기간 없는 현물만 있는 딜 — 배분표는 비지만 미배분 금액은 남는다', async () => {
  // 화면이 「연차 배분」 절을 배열 길이로만 그리면 이 안내가 통째로 사라진다
  const { db } = fakeDb({
    deal: baseDeal({ contractNetMinor: 억(2), bookedNetMinor: 억(2) }),
    funding: [],
    inKind: [{ id: 'k1', kind: 'LABOR', name: '기간 미정', valueMinor: 억(2), quantity: null, unit: null, basisNote: null, startDate: null, endDate: null, position: 0 }],
  })
  const json = toLedgerJson(await getLedger(db, 'd1'), { role: 'ADMIN' })
  assert.deepEqual(json.inKindByYear, [])
  assert.equal(json.inKindUndatedMinor, '200000000', '0으로 때우지 않았다는 사실이 남는다')
})
