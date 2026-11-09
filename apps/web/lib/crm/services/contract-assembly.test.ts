/**
 * 계약에 모듈을 골라 조립 (P0184 I12)
 *
 *   1 미리 보기: 공통 + 고른 것 + 조건이 맞는 것, 조건이 맞아 들어간 것은 automatic 으로 따로 말함
 *   2 승인본이 없는 조항 키가 있으면 저장하지 않고 그 키를 말함
 *   3 없는 모듈 키, 모양이 틀린 목록은 거절
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { assembleContractModules } from './contract-assembly.ts'
import { CrmError } from '../domain/errors.ts'
import { CONTRACT_ASSEMBLY_MSG, CONTRACT_MODULE_MSG } from '../../terms/contract-doc.ts'

type Row = Record<string, unknown>

const failsWith = (code: string, message?: string) => (e: unknown) =>
  e instanceof CrmError && e.code === code && (message === undefined || e.message === message)

function fakeDb(clauses: Row[]) {
  const modules: Row[] = [
    { key: 'common.base', kind: 'COMMON', title: '공통', clauseKeys: ['common.purpose'], enableWhen: null, position: 0, isActive: true },
    { key: 'perf.gpu', kind: 'PERFORMANCE', title: 'GPU 임대', clauseKeys: ['perf.gpu'], enableWhen: null, position: 1, isActive: true },
    { key: 'reg.purchase', kind: 'REGULATION', title: '매입 규제', clauseKeys: ['reg.purchase'],
      enableWhen: { all: [{ field: 'direction', op: 'in', values: ['PURCHASE'] }] }, position: 2, isActive: true },
    { key: 'off.module', kind: 'ANNEX', title: '꺼진 모듈', clauseKeys: [], enableWhen: null, position: 3, isActive: false },
  ]
  const inList = (row: Row, where: Row) => Object.entries(where).every(([k, v]) =>
    v && typeof v === 'object' && 'in' in (v as Row) ? ((v as { in: unknown[] }).in).includes(row[k]) : row[k] === v)
  return {
    crmContract: {
      findFirst: async () => ({ id: 'ct1', dealId: null, direction: 'PURCHASE', status: 'DRAFT', currentVersionNo: 1, version: 3, totalMinor: null }),
    },
    crmContractVersion: {
      findFirst: async () => ({ versionNo: 1, body: [], fieldValues: { 'contract.amount': { value: '1000', source: 'manual' } } }),
    },
    crmDeal: { findFirst: async () => null },
    crmContractModule: { findMany: async ({ where }: { where: Row }) => modules.filter((m) => inList(m, where)) },
    crmContractClause: { findMany: async ({ where }: { where: Row }) => clauses.filter((c) => inList(c, where)) },
  }
}

const approved = (key: string, title: string) => ({ key, lang: 'ko', status: 'APPROVED', versionNo: 1, title, html: `<p>${title} 본문</p>` })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asDb = (d: unknown) => d as any

test('1 미리 보기는 공통 고른 것 조건이 맞는 것을 담고, 조건으로 들어간 것을 따로 말한다', async () => {
  const db = fakeDb([approved('common.purpose', '목적'), approved('perf.gpu', 'GPU 임대'), approved('reg.purchase', '매입 규제')])
  const out = await assembleContractModules(asDb(db), 'ws1', 'm1', 'ct1', 3, { moduleKeys: ['perf.gpu'], dryRun: true })
  assert.deepEqual(out.modules.sort(), ['common.base', 'perf.gpu', 'reg.purchase'])
  assert.deepEqual(out.automatic, ['reg.purchase'])
  assert.deepEqual(out.missing, [])
  assert.equal(out.clauseCount, 3)
  assert.equal(out.saved, null)
  // 골랐어도 조건이 정하는 모듈은 저절로 들어간 것으로 센다
  const again = await assembleContractModules(asDb(db), 'ws1', 'm1', 'ct1', 3, { moduleKeys: ['perf.gpu', 'reg.purchase'], dryRun: true })
  assert.deepEqual(again.automatic, ['reg.purchase'])
})

test('2 승인본이 없는 조항이 있으면 저장하지 않고 그 키를 말한다', async () => {
  const draftOnly = { ...approved('perf.gpu', 'GPU 임대'), status: 'DRAFT' }
  const db = fakeDb([approved('common.purpose', '목적'), draftOnly, approved('reg.purchase', '매입 규제')])
  const dry = await assembleContractModules(asDb(db), 'ws1', 'm1', 'ct1', 3, { moduleKeys: ['perf.gpu'], dryRun: true })
  assert.deepEqual(dry.missing, ['perf.gpu'])
  await assert.rejects(
    assembleContractModules(asDb(db), 'ws1', 'm1', 'ct1', 3, { moduleKeys: ['perf.gpu'] }),
    failsWith('VALIDATION_FAILED', CONTRACT_MODULE_MSG.missingClauses('perf.gpu')),
  )
})

test('3 없거나 꺼진 모듈 키, 모양이 틀린 목록은 거절', async () => {
  const db = fakeDb([])
  await assert.rejects(assembleContractModules(asDb(db), 'ws1', 'm1', 'ct1', 3, { moduleKeys: ['off.module'] }),
    failsWith('VALIDATION_FAILED', CONTRACT_ASSEMBLY_MSG.unknownModules('off.module')))
  await assert.rejects(assembleContractModules(asDb(db), 'ws1', 'm1', 'ct1', 3, { moduleKeys: 'perf.gpu' }),
    failsWith('VALIDATION_FAILED', CONTRACT_ASSEMBLY_MSG.badModuleKeys))
})
