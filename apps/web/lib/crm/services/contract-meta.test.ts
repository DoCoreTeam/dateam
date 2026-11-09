/**
 * 계약 정보 고치기 (P0184 I10)
 *
 *   1 방향 양식 종류 제목을 고치고 감사를 남긴다, 방향이 바뀌면 등급도 따라 바뀐다
 *   2 볼 수 없는 등급(회사 단위)으로는 관리자가 아니면 못 바꾼다
 *   3 당사자를 바꾸면 당사자에서 채운 칸이 바뀐 다음 버전이 생기고 손으로 넣은 칸은 그대로다
 *   4 견적에서 만든 계약의 당사자, 체결한 계약, 낡은 버전, 모르는 값은 거절한다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { updateContractMeta } from './contract-meta.ts'
import { CrmError } from '../domain/errors.ts'
import { CONTRACT_MSG, CONTRACT_META } from '../../terms/contract-doc.ts'

type Row = Record<string, unknown>

function fakeDb(over: Row = {}) {
  const store = {
    contract: {
      id: 'k1', dealId: null, direction: 'SALES', formOwner: 'OURS', docLayer: 'STANDALONE', sensitivity: 'SALES', quoteId: null,
      contractNo: 'CT-1', title: '처음 제목', status: 'DRAFT', templateId: 'tpl', parentContractId: null, currentVersionNo: 1,
      sentAt: null, sentVersionNo: null, concludedAt: null, totalMinor: null, currency: null, version: 3,
      createdAt: new Date(0), updatedAt: new Date(0), ...over,
    } as Row,
    versions: [{
      versionNo: 1, body: [{ id: 'c1', title: '목적', html: '<p>{{갑.상호}}</p>' }], signatureSnapshot: null, templateVersionNo: 1,
      fieldValues: { 'supplier.name': { value: '예전 공급사', source: 'auto' }, 'contract.scope': { value: '손으로 쓴 범위', source: 'manual' } },
    }] as Row[],
    parties: [] as Row[],
    audits: [] as Row[],
  }
  const db = {
    store,
    $transaction: async <R>(fn: (tx: unknown) => Promise<R>) => fn(db),
    $executeRawUnsafe: async () => 0,
    crmContract: {
      findFirst: async () => ({ ...store.contract }),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        if (where.version !== store.contract.version) return { count: 0 }
        const { version: _v, ...rest } = data
        store.contract = { ...store.contract, ...rest, version: (store.contract.version as number) + 1 }
        return { count: 1 }
      },
    },
    crmContractVersion: {
      findFirst: async ({ where }: { where: Row }) => store.versions.find((v) => v.versionNo === where.versionNo) ?? null,
      create: async ({ data }: { data: Row }) => { store.versions.push(data); return data },
    },
    crmContractParty: {
      deleteMany: async () => { const n = store.parties.length; store.parties = []; return { count: n } },
      createMany: async ({ data }: { data: Row[] }) => { store.parties.push(...data); return { count: data.length } },
    },
    crmCompany: { count: async () => 0 },
    crmAuditLog: { create: async ({ data }: { data: Row }) => { store.audits.push(data); return data } },
  }
  return db
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asDb = (d: unknown) => d as any
const MEMBER = { memberId: 'm1', role: 'MEMBER' as const }
const ADMIN = { memberId: 'a1', role: 'ADMIN' as const }
const code = (c: string, message?: string) => (e: unknown) => e instanceof CrmError && e.code === c && (message === undefined || e.message === message)

test('방향 양식 종류 제목을 고치고 등급이 방향을 따라간다, 감사가 남는다', async () => {
  const db = fakeDb()
  const row = await updateContractMeta(asDb(db), 'ws1', MEMBER, 'k1', 3, { direction: 'PURCHASE', formOwner: 'THEIRS', docLayer: 'MASTER', title: ' 새 제목 ' })
  assert.deepEqual([row.direction, row.sensitivity, row.formOwner, row.docLayer, row.title], ['PURCHASE', 'PURCHASE', 'THEIRS', 'MASTER', '새 제목'])
  assert.equal(db.store.versions.length, 1, '당사자를 안 바꾸면 버전을 안 남긴다')
  assert.equal(db.store.audits.at(-1)!.action, 'contract.meta_updated')
})

test('관리자가 아니면 회사 단위로 못 바꾼다, 관리자는 바꾼다', async () => {
  await assert.rejects(updateContractMeta(asDb(fakeDb()), 'ws1', MEMBER, 'k1', 3, { direction: 'CORPORATE' }), code('FORBIDDEN', CONTRACT_MSG.sensitivityDenied))
  const row = await updateContractMeta(asDb(fakeDb()), 'ws1', ADMIN, 'k1', 3, { direction: 'CORPORATE' })
  assert.equal(row.sensitivity, 'CORPORATE')
})

test('당사자를 바꾸면 당사자 칸이 새로 채워진 다음 버전이 생기고 손으로 넣은 칸은 그대로다', async () => {
  const db = fakeDb()
  const row = await updateContractMeta(asDb(db), 'ws1', MEMBER, 'k1', 3, {
    parties: [{ role: 'SUPPLIER', isSelf: true, snapshot: { name: '우리' } }, { role: 'CUSTOMER', snapshot: { name: '새 고객' } }],
  })
  assert.equal(row.currentVersionNo, 2)
  const v2 = db.store.versions[1] as { fieldValues: Record<string, { value: string; source: string }>; kind: string }
  assert.equal(v2.kind, 'EDITED')
  assert.equal(v2.fieldValues['supplier.name'].value, '우리')
  assert.equal(v2.fieldValues['customer.name'].value, '새 고객')
  assert.deepEqual(v2.fieldValues['contract.scope'], { value: '손으로 쓴 범위', source: 'manual' })
  assert.deepEqual(db.store.parties.map((p) => [p.role, p.position]), [['SUPPLIER', 0], ['CUSTOMER', 1]])
})

test('견적에서 만든 계약의 당사자, 체결한 계약, 낡은 버전, 모르는 값은 거절한다', async () => {
  const parties = [{ role: 'SUPPLIER', snapshot: { name: 'x' } }]
  await assert.rejects(updateContractMeta(asDb(fakeDb({ quoteId: 'q1' })), 'ws1', MEMBER, 'k1', 3, { parties }), code('VALIDATION_FAILED', CONTRACT_META.partiesFollowQuote))
  await assert.rejects(updateContractMeta(asDb(fakeDb({ status: 'CONCLUDED' })), 'ws1', ADMIN, 'k1', 3, { title: 't' }), code('INVALID_TRANSITION', CONTRACT_META.notDraft))
  await assert.rejects(updateContractMeta(asDb(fakeDb()), 'ws1', MEMBER, 'k1', 2, { title: 't' }), code('CONFLICT'))
  await assert.rejects(updateContractMeta(asDb(fakeDb()), 'ws1', MEMBER, 'k1', 3, { direction: 'LOAN' }), code('VALIDATION_FAILED', CONTRACT_MSG.badDirection))
  await assert.rejects(updateContractMeta(asDb(fakeDb()), 'ws1', MEMBER, 'k1', 3, { parties: [] }), code('VALIDATION_FAILED'))
})
