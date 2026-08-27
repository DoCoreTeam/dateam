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
  getLedger, recalcLedger, addInKind, setFunding, toLedgerJson,
  IN_KIND_LABEL, IN_KIND_BASIS_HINT,
} from './ledger.ts'
import type { CrmDb } from '../db/client.ts'

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
