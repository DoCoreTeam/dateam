/**
 * 회사 단위 계약은 관리자만 본다 (P0184 I02)
 *
 *   1 거름망: 관리자 아닌 역할이면 CrmContract 조건에 등급이 들어가고, 문맥이 없으면 관리자 아닌 쪽으로 센다
 *   2 서비스: 같은 거름망을 낀 가짜 DB 로 listContracts findContract getContract 를 실제로 부른다
 *   3 배선: getCrmDb 확장과 두 입구(withCrmApi, 공개 API 다리)가 거름망과 문맥을 실제로 쓴다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  guardContractSensitivity, runAsCrmViewer, currentCrmViewerRole, visibleSensitivities, sensitivityOfDirection,
} from './contract-sensitivity.ts'
import { CrmError } from './errors.ts'
import { findContract, getContract, listContracts } from '../services/contract.ts'
import { CONTRACT_MSG } from '../../terms/contract-doc.ts'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const isNotFound = (e: unknown) => e instanceof CrmError && e.code === 'NOT_FOUND' && e.message === CONTRACT_MSG.notFound

// ------------------------------------------------------------
// 1 거름망
// ------------------------------------------------------------

test('관리자만 CORPORATE 를 본다, 문맥이 없으면 관리자 아닌 쪽', () => {
  assert.deepEqual(visibleSensitivities('OWNER'), ['SALES', 'PURCHASE', 'CORPORATE'])
  assert.deepEqual(visibleSensitivities('ADMIN'), ['SALES', 'PURCHASE', 'CORPORATE'])
  assert.deepEqual(visibleSensitivities('MEMBER'), ['SALES', 'PURCHASE'])
  assert.deepEqual(visibleSensitivities('READONLY'), ['SALES', 'PURCHASE'])
  assert.deepEqual(visibleSensitivities(null), ['SALES', 'PURCHASE'])
})

test('관리자 아니면 읽기 고치기 지우기 조건에 등급이 들어간다', () => {
  for (const op of ['findFirst', 'findUnique', 'findMany', 'count', 'updateMany', 'deleteMany']) {
    const out = guardContractSensitivity('CrmContract', op, { where: { id: 'c1' } }, 'MEMBER') as { where: Record<string, unknown> }
    assert.deepEqual(out.where, { id: 'c1', sensitivity: { in: ['SALES', 'PURCHASE'] } }, op)
  }
})

test('호출부가 등급을 적어도 덮어 열지 않는다', () => {
  const out = guardContractSensitivity('CrmContract', 'findMany', { where: { sensitivity: 'CORPORATE' } }, 'MEMBER') as { where: unknown }
  assert.deepEqual(out.where, { AND: [{ sensitivity: 'CORPORATE' }, { sensitivity: { in: ['SALES', 'PURCHASE'] } }] })
})

test('관리자와 다른 모델은 그대로 지나간다, 원본 args 는 안 바뀐다', () => {
  const args = { where: { id: 'c1' } }
  assert.equal(guardContractSensitivity('CrmContract', 'findFirst', args, 'ADMIN'), args)
  assert.equal(guardContractSensitivity('CrmDeal', 'findFirst', args, 'MEMBER'), args)
  guardContractSensitivity('CrmContract', 'findFirst', args, 'MEMBER')
  assert.deepEqual(args, { where: { id: 'c1' } })
})

test('관리자 아니면 회사 단위 계약을 못 만든다', () => {
  assert.throws(() => guardContractSensitivity('CrmContract', 'create', { data: { sensitivity: 'CORPORATE' } }, 'MEMBER'),
    (e) => e instanceof CrmError && e.code === 'FORBIDDEN')
  assert.throws(() => guardContractSensitivity('CrmContract', 'create', { data: { sensitivity: 'CORPORATE' } }, null),
    (e) => e instanceof CrmError && e.code === 'FORBIDDEN')
  assert.doesNotThrow(() => guardContractSensitivity('CrmContract', 'create', { data: { sensitivity: 'PURCHASE' } }, 'MEMBER'))
  assert.doesNotThrow(() => guardContractSensitivity('CrmContract', 'create', { data: { sensitivity: 'CORPORATE' } }, 'ADMIN'))
})

test('방향에서 등급이 나온다', () => {
  assert.equal(sensitivityOfDirection('CORPORATE'), 'CORPORATE')
  assert.equal(sensitivityOfDirection('PURCHASE'), 'PURCHASE')
  assert.equal(sensitivityOfDirection('SALES'), 'SALES')
  assert.equal(sensitivityOfDirection('CONSORTIUM'), 'SALES')
})

test('문맥은 연 안에서만 보이고 비동기를 건너간다', async () => {
  assert.equal(currentCrmViewerRole(), null)
  const seen = await runAsCrmViewer('ADMIN', async () => {
    await new Promise((r) => setTimeout(r, 1))
    return currentCrmViewerRole()
  })
  assert.equal(seen, 'ADMIN')
  assert.equal(currentCrmViewerRole(), null)
})

// ------------------------------------------------------------
// 2 서비스 — getCrmDb 확장과 같은 자리에서 거름망을 끼운 가짜 DB
// ------------------------------------------------------------

const BASE = {
  dealId: null, quoteId: null, title: '계약', status: 'DRAFT', templateId: null, parentContractId: null,
  currentVersionNo: 1, sentAt: null, sentVersionNo: null, concludedAt: null, totalMinor: null, currency: null,
  version: 1, createdAt: new Date(0), updatedAt: new Date(0), deletedAt: null,
}
const ROWS = [
  { ...BASE, id: 'c-sales', contractNo: 'C-1', sensitivity: 'SALES' },
  { ...BASE, id: 'c-buy', contractNo: 'C-2', sensitivity: 'PURCHASE' },
  { ...BASE, id: 'c-corp', contractNo: 'C-3', sensitivity: 'CORPORATE' },
]

type Where = { id?: string; sensitivity?: { in: string[] } }
const match = (r: (typeof ROWS)[number], w: Where = {}) =>
  (w.id === undefined || r.id === w.id) && (w.sensitivity === undefined || w.sensitivity.in.includes(r.sensitivity))

function fakeDb() {
  const guarded = (op: string, args: unknown) =>
    guardContractSensitivity('CrmContract', op, args, currentCrmViewerRole()) as { where?: Where; take?: number }
  return {
    crmContract: {
      findMany: async (args: unknown) => {
        const a = guarded('findMany', args)
        return ROWS.filter((r) => match(r, a.where)).map((r) => ({ ...r, deal: null }))
      },
      findFirst: async (args: unknown) => ROWS.find((r) => match(r, guarded('findFirst', args).where)) ?? null,
    },
    crmContractVersion: {
      findFirst: async () => ({ versionNo: 1, kind: 'DRAFT', body: [], fieldValues: { auto: {}, manual: {} }, quoteSnapshot: null }),
    },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = fakeDb() as any

test('관리자 아닌 역할: 목록에 회사 단위 계약이 없다', async () => {
  for (const role of ['MEMBER', 'READONLY']) {
    const { items } = await runAsCrmViewer(role, () => listContracts(db, {}))
    assert.deepEqual(items.map((i) => i.id), ['c-sales', 'c-buy'], role)
  }
})

test('관리자 아닌 역할: 회사 단위 계약 단건은 없는 계약과 같은 대답', async () => {
  await runAsCrmViewer('MEMBER', async () => {
    await assert.rejects(findContract(db, 'c-corp'), isNotFound)
    await assert.rejects(getContract(db, 'c-corp'), isNotFound)
    await assert.rejects(findContract(db, 'no-such'), isNotFound)
    assert.equal((await findContract(db, 'c-buy')).id, 'c-buy')
  })
})

test('관리자: 회사 단위 계약이 목록과 단건에 보인다', async () => {
  await runAsCrmViewer('ADMIN', async () => {
    const { items } = await listContracts(db, {})
    assert.deepEqual(items.map((i) => i.id), ['c-sales', 'c-buy', 'c-corp'])
    assert.equal((await findContract(db, 'c-corp')).id, 'c-corp')
  })
})

test('문맥 없는 호출(잡 스크립트)은 회사 단위 계약만 못 본다', async () => {
  const { items } = await listContracts(db, {})
  assert.deepEqual(items.map((i) => i.id), ['c-sales', 'c-buy'])
  await assert.rejects(findContract(db, 'c-corp'), isNotFound)
})

// ------------------------------------------------------------
// 3 배선 — 거름망이 함수로만 있고 안 불리면 위 시험은 초록인데 운영은 열린다
// ------------------------------------------------------------

test('getCrmDb 확장이 모든 crm 연산에 거름망을 문맥 역할로 끼운다', () => {
  const src = read('lib/crm/db/client.ts')
  assert.match(src, /query\(guardContractSensitivity\(model, operation, scoped, currentCrmViewerRole\(\)\)/)
})

test('두 입구가 확인한 세션 역할로 문맥을 열고 그 안에서 처리 함수를 부른다', () => {
  assert.match(read('lib/crm/api/handler.ts'),
    /runAsCrmViewer\(session\.role, \(\) => fn\(\{ session, db: getCrmDb\(session\.workspaceId\) \}\)\)/)
  assert.match(read('lib/public-api/crm-bridge.ts'), /runAsCrmViewer\(access\.session\.role, \(\) => fn\(\{/)
})
