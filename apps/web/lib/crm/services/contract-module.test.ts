/**
 * 계약 모듈 관리 (P0184 I11)
 *
 *   1 만들기 고치기 지우기는 관리자만 — 서비스가 역할을 다시 본다, 문맥이 없으면 거절
 *   2 라이브러리에 없는 조항 키, 겹친 키, 모르는 조건 칸은 거절
 *   3 고치기는 version 이 맞을 때만, 조건을 null 로 보내면 「고를 때만」으로 돌아간다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'

import { createModule, deleteModule, listModules, updateModule } from './contract-module.ts'
import { CrmError } from '../domain/errors.ts'
import { runAsCrmViewer } from '../domain/contract-sensitivity.ts'
import { CONTRACT_MODULE_MSG } from '../../terms/contract-doc.ts'

type Row = Record<string, unknown>

const failsWith = (code: string, message?: string) => (e: unknown) =>
  e instanceof CrmError && e.code === code && (message === undefined || e.message === message)

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && 'in' in (v as Row)) return ((v as { in: unknown[] }).in).includes(row[k])
    return row[k] === v
  })
}

function fakeDb() {
  const store = { modules: [] as Row[], clauses: [{ key: 'common.purpose' }, { key: 'perf.gpu' }] as Row[], audits: [] as Row[] }
  let seq = 0
  const db = {
    store,
    $transaction: async <R>(fn: (tx: unknown) => Promise<R>) => fn(db),
    $executeRawUnsafe: async () => 0,
    crmContractClause: {
      findMany: async ({ where }: { where: Row }) => store.clauses.filter((c) => matches(c, where)).map((r) => ({ ...r })),
    },
    crmContractModule: {
      findFirst: async ({ where }: { where: Row }) => {
        const r = store.modules.find((m) => matches(m, where))
        return r ? { ...r } : null
      },
      findMany: async ({ where }: { where: Row }) => store.modules.filter((m) => matches(m, where)).map((r) => ({ ...r })),
      create: async ({ data }: { data: Row }) => {
        const row = { id: `md${++seq}`, version: 0, enableWhen: null, updatedAt: new Date(0), ...data }
        store.modules.push(row)
        return { ...row }
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = store.modules.filter((m) => matches(m, where))
        for (const r of rows) {
          for (const [k, v] of Object.entries(data)) {
            r[k] = v && typeof v === 'object' && 'increment' in (v as Row) ? (r[k] as number) + 1 : v === Prisma.DbNull ? null : v
          }
        }
        return { count: rows.length }
      },
      deleteMany: async ({ where }: { where: Row }) => {
        const before = store.modules.length
        store.modules = store.modules.filter((m) => !matches(m, where))
        return { count: before - store.modules.length }
      },
    },
    crmAuditLog: { create: async ({ data }: { data: Row }) => { store.audits.push(data); return data } },
  }
  return db
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asDb = (d: ReturnType<typeof fakeDb>) => d as any
const GPU = {
  key: 'perf.gpu-rental', kind: 'PERFORMANCE', title: 'GPU 임대', clauseKeys: ['perf.gpu'],
  enableWhen: { all: [{ field: 'direction', op: 'in', values: ['SALES'] }] },
}
const asAdmin = <T>(fn: () => Promise<T>) => runAsCrmViewer('ADMIN', fn)

test('1 관리자가 아니면 만들기 고치기 지우기 모두 거절, 문맥이 없어도 거절', async () => {
  const db = fakeDb()
  await assert.rejects(createModule(asDb(db), 'ws1', 'm1', GPU), failsWith('FORBIDDEN', CONTRACT_MODULE_MSG.editDenied))
  await assert.rejects(runAsCrmViewer('MEMBER', () => createModule(asDb(db), 'ws1', 'm1', GPU)), failsWith('FORBIDDEN'))
  const m = await asAdmin(() => createModule(asDb(db), 'ws1', 'a1', GPU))
  await assert.rejects(runAsCrmViewer('MEMBER', () => updateModule(asDb(db), 'ws1', 'm1', m.id, m.version, { title: '바꿈' })), failsWith('FORBIDDEN'))
  await assert.rejects(runAsCrmViewer('MEMBER', () => deleteModule(asDb(db), 'ws1', 'm1', m.id)), failsWith('FORBIDDEN'))
  assert.equal(db.store.modules.length, 1)
  assert.equal(db.store.modules[0].title, 'GPU 임대')
})

test('1 관리자는 만들고 목록에서 읽고 지운다, 감사 기록이 남는다', async () => {
  const db = fakeDb()
  const m = await asAdmin(() => createModule(asDb(db), 'ws1', 'a1', GPU))
  assert.deepEqual(m.clauseKeys, ['perf.gpu'])
  assert.deepEqual(m.enableWhen, { all: [{ field: 'direction', op: 'in', values: ['SALES'] }] })
  assert.equal((await listModules(asDb(db))).length, 1)
  await assert.rejects(asAdmin(() => createModule(asDb(db), 'ws1', 'a1', GPU)), failsWith('CONFLICT', CONTRACT_MODULE_MSG.keyTaken))
  await asAdmin(() => deleteModule(asDb(db), 'ws1', 'a1', m.id))
  assert.equal(db.store.modules.length, 0)
  assert.deepEqual(db.store.audits.map((a) => a.action), ['contract_module.created', 'contract_module.deleted'])
})

test('2 없는 조항 키, 겹친 키, 모르는 조건 칸, 모르는 종류는 거절', async () => {
  const db = fakeDb()
  await assert.rejects(asAdmin(() => createModule(asDb(db), 'ws1', 'a1', { ...GPU, clauseKeys: ['perf.gpu', 'perf.nope'] })),
    failsWith('VALIDATION_FAILED', CONTRACT_MODULE_MSG.unknownClauses('perf.nope')))
  await assert.rejects(asAdmin(() => createModule(asDb(db), 'ws1', 'a1', { ...GPU, clauseKeys: ['perf.gpu', 'perf.gpu'] })),
    failsWith('VALIDATION_FAILED', CONTRACT_MODULE_MSG.badClauseKeys))
  await assert.rejects(asAdmin(() => createModule(asDb(db), 'ws1', 'a1', { ...GPU, enableWhen: { all: [{ field: 'ownerEmail', op: 'truthy' }] } })),
    failsWith('VALIDATION_FAILED', CONTRACT_MODULE_MSG.badConditionField('ownerEmail')))
  await assert.rejects(asAdmin(() => createModule(asDb(db), 'ws1', 'a1', { ...GPU, kind: 'PAYMENT' })),
    failsWith('VALIDATION_FAILED', CONTRACT_MODULE_MSG.badKind))
  assert.equal(db.store.modules.length, 0)
})

test('3 고치기는 version 이 맞을 때만, 조건 null 은 고를 때만으로 되돌린다', async () => {
  const db = fakeDb()
  const m = await asAdmin(() => createModule(asDb(db), 'ws1', 'a1', GPU))
  const next = await asAdmin(() => updateModule(asDb(db), 'ws1', 'a1', m.id, m.version, {
    title: 'GPU 임대 (월)', clauseKeys: ['common.purpose', 'perf.gpu'], enableWhen: null,
  }))
  assert.equal(next.title, 'GPU 임대 (월)')
  assert.deepEqual(next.clauseKeys, ['common.purpose', 'perf.gpu'])
  assert.equal(next.enableWhen, null)
  assert.equal(next.version, m.version + 1)
  await assert.rejects(asAdmin(() => updateModule(asDb(db), 'ws1', 'a1', m.id, m.version, { title: '늦은 저장' })),
    failsWith('CONFLICT', CONTRACT_MODULE_MSG.conflict))
})
