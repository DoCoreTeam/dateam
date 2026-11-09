/**
 * 딜 없이 계약 만들기와 당사자 N명 (P0184 I03)
 *
 *   1 당사자 검사: 0명 거절, 공동수급은 주관사 하나, 우리 회사는 한 번, 모양 틀림 거절
 *   2 만들기: 가짜 DB 로 createContract 를 실제로 불러 계약 행, 버전 1, 당사자 행, 감사 기록이 한 트랜잭션에 쓰이는지
 *   3 견적에서 만들기는 공급자(우리)와 고객 두 당사자 행을 함께 쓴다
 *   4 번호 셈은 등급 거름망을 안 지난다 — 회사 단위 계약 번호를 멤버가 다시 집지 않게
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { checkParties, partiesFromQuote, MAX_PARTIES, type PartyInput } from './contract-party.ts'
import { createContract } from './contract-create.ts'
import { CrmError } from '../domain/errors.ts'
import { guardContractSensitivity, runAsCrmViewer, currentCrmViewerRole } from '../domain/contract-sensitivity.ts'
import type { QuoteDocument } from '../domain/quote-document.ts'
import { CONTRACT_MSG, CONTRACT_PARTY_MSG } from '../../terms/contract-doc.ts'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const failsWith = (code: string, message?: string) => (e: unknown) =>
  e instanceof CrmError && e.code === code && (message === undefined || e.message === message)

// 합성 견본 — 상호는 지어낸 것이다
const US = { role: 'SUPPLIER', isSelf: true, snapshot: { name: '주식회사 에이엑스', bizNo: '123-45-67890' } }
const VENDOR = { role: 'SUPPLIER', isSelf: false, snapshot: { name: '한빛서버' } }
const BUYER_US = { role: 'CUSTOMER', isSelf: true, snapshot: { name: '주식회사 에이엑스' } }

// ------------------------------------------------------------
// 1 당사자 검사
// ------------------------------------------------------------

test('당사자 0명은 거절한다', () => {
  assert.throws(() => checkParties([], 'SALES'), failsWith('VALIDATION_FAILED', CONTRACT_PARTY_MSG.required))
  assert.throws(() => checkParties(undefined, 'SALES'), failsWith('VALIDATION_FAILED', CONTRACT_PARTY_MSG.required))
})

test('공동수급은 주관사 하나와 구성원 여럿, 순서를 지킨다', () => {
  const ps = checkParties([
    { role: 'LEAD', isSelf: true, snapshot: { name: '주식회사 에이엑스' } },
    { role: 'MEMBER', snapshot: { name: '가람정보' } },
    { role: 'MEMBER', snapshot: { name: '나래시스템' } },
  ], 'CONSORTIUM')
  assert.deepEqual(ps.map((p) => [p.role, p.snapshot.name, p.isSelf]), [
    ['LEAD', '주식회사 에이엑스', true], ['MEMBER', '가람정보', false], ['MEMBER', '나래시스템', false],
  ])
  assert.throws(() => checkParties([{ role: 'MEMBER', snapshot: { name: 'a' } }, { role: 'MEMBER', snapshot: { name: 'b' } }], 'CONSORTIUM'),
    failsWith('VALIDATION_FAILED', CONTRACT_PARTY_MSG.consortiumLead))
})

test('우리 회사는 한 번만, 역할과 상호와 모양을 검사한다', () => {
  assert.throws(() => checkParties([US, { ...BUYER_US }], 'SALES'), failsWith('VALIDATION_FAILED', CONTRACT_PARTY_MSG.selfOnce))
  assert.throws(() => checkParties([{ role: 'BOSS', snapshot: { name: 'a' } }], 'SALES'), failsWith('VALIDATION_FAILED', CONTRACT_PARTY_MSG.badRole(1)))
  assert.throws(() => checkParties([US, { role: 'CUSTOMER', snapshot: { name: '  ' } }], 'SALES'), failsWith('VALIDATION_FAILED', CONTRACT_PARTY_MSG.nameRequired(2)))
  assert.throws(() => checkParties([{ ...US, isSelf: 'yes' }], 'SALES'), failsWith('VALIDATION_FAILED', CONTRACT_PARTY_MSG.badShape(1)))
  assert.throws(() => checkParties([{ ...US, snapshot: { name: 'x'.repeat(201) } }], 'SALES'), failsWith('VALIDATION_FAILED', CONTRACT_PARTY_MSG.valueTooLong(1)))
  assert.throws(() => checkParties(Array.from({ length: MAX_PARTIES + 1 }, () => VENDOR), 'SALES'),
    failsWith('VALIDATION_FAILED', CONTRACT_PARTY_MSG.tooMany(MAX_PARTIES)))
})

test('스냅샷은 알려진 칸만 남기고 공백을 다듬는다', () => {
  const [p] = checkParties([{ role: 'PARTNER', snapshot: { name: ' 가람 ', ceo: '', hack: '<script>' } }], 'PARTNERSHIP')
  assert.deepEqual(p.snapshot, { name: '가람' })
})

// ------------------------------------------------------------
// 2 만들기 — 가짜 DB. getCrmDb 확장처럼 등급 거름망을 끼운다
// ------------------------------------------------------------

interface Store {
  contracts: Record<string, unknown>[]
  versions: Record<string, unknown>[]
  parties: Record<string, unknown>[]
  audits: Record<string, unknown>[]
  rawSql: string[]
}

function fakeDb(opts: { existingNos?: string[]; companies?: string[]; deals?: string[] } = {}) {
  const store: Store = { contracts: [], versions: [], parties: [], audits: [], rawSql: [] }
  const guard = (op: string, args: unknown) => guardContractSensitivity('CrmContract', op, args, currentCrmViewerRole()) as Record<string, unknown>
  const db = {
    store,
    $transaction: async <R>(fn: (tx: unknown) => Promise<R>) => fn(db),
    $executeRawUnsafe: async () => 0,
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      store.rawSql.push(strings.join('?'))
      const prefix = String(values[0])
      const nos = [...(opts.existingNos ?? []), ...store.contracts.map((c) => String(c.contractNo))]
        .filter((n) => n.startsWith(prefix)).sort().reverse()
      return nos.length ? [{ contractNo: nos[0] }] : []
    },
    crmAppSetting: { findMany: async () => [] },
    crmContractTemplate: {
      findFirst: async () => ({ id: 'tpl', name: '표준', businessTypeKey: null, isDefault: true, position: 0, draftBody: [], currentVersionNo: 1, version: 1, updatedAt: new Date(0) }),
    },
    crmContractTemplateVersion: {
      findFirst: async () => ({ body: [{ id: 'k1', title: '제1조 (목적)', html: '<p>목적</p>' }] }),
    },
    crmCompany: { count: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter((id) => (opts.companies ?? []).includes(id)).length },
    crmDeal: { findFirst: async ({ where }: { where: { id: string } }) => ((opts.deals ?? []).includes(where.id) ? { businessTypeKey: null } : null) },
    crmContract: {
      create: async (args: unknown) => {
        const a = guard('create', args) as { data: Record<string, unknown> }
        const row = { id: `c${store.contracts.length + 1}`, status: 'DRAFT', quoteId: null, parentContractId: null, sentAt: null, sentVersionNo: null, concludedAt: null, totalMinor: null, currency: null, version: 0, createdAt: new Date(0), updatedAt: new Date(0), ...a.data }
        store.contracts.push(row)
        return row
      },
    },
    crmContractVersion: { create: async ({ data }: { data: Record<string, unknown> }) => { store.versions.push(data); return data } },
    crmContractParty: { createMany: async ({ data }: { data: Record<string, unknown>[] }) => { store.parties.push(...data); return { count: data.length } } },
    crmAuditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { store.audits.push(data); return data } },
  }
  return db
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asDb = (d: ReturnType<typeof fakeDb>) => d as any

test('딜 없이 매입 계약을 만든다 — 등급 매입, 당사자 둘, 버전 1, 감사 한 줄', async () => {
  const db = fakeDb()
  const { contract, versionNo } = await runAsCrmViewer('MEMBER', () => createContract(asDb(db), 'ws1', 'm1', {
    direction: 'PURCHASE', title: 'GPU 서버 매입', templateId: 'tpl', parties: [VENDOR, BUYER_US],
  }))
  assert.equal(versionNo, 1)
  assert.equal(contract.dealId, null)
  assert.equal(contract.direction, 'PURCHASE')
  assert.equal(contract.sensitivity, 'PURCHASE')
  assert.equal(contract.formOwner, 'OURS')
  assert.equal(contract.docLayer, 'STANDALONE')
  assert.deepEqual(db.store.parties.map((p) => [p.role, p.isSelf, p.position, p.contractId]), [
    ['SUPPLIER', false, 0, contract.id], ['CUSTOMER', true, 1, contract.id],
  ])
  assert.equal(db.store.versions.length, 1)
  const fv = db.store.versions[0].fieldValues as Record<string, { value: string }>
  assert.equal(fv['supplier.name'].value, '한빛서버')
  assert.equal(fv['customer.name'].value, '주식회사 에이엑스')
  assert.equal(db.store.audits.length, 1)
})

test('당사자 셋인 공동수급 계약을 만든다', async () => {
  const db = fakeDb({ companies: ['co-a'] })
  const { contract } = await runAsCrmViewer('MEMBER', () => createContract(asDb(db), 'ws1', 'm1', {
    direction: 'CONSORTIUM', title: '국책 과제 공동수급', templateId: 'tpl', docLayer: 'MOU',
    parties: [
      { role: 'LEAD', isSelf: true, snapshot: { name: '주식회사 에이엑스' } },
      { role: 'MEMBER', companyId: 'co-a', snapshot: { name: '가람정보' } },
      { role: 'MEMBER', snapshot: { name: '나래시스템' } },
    ],
  }))
  assert.equal(contract.direction, 'CONSORTIUM')
  assert.equal(contract.docLayer, 'MOU')
  assert.equal(db.store.parties.length, 3)
  assert.equal(db.store.parties[1].companyId, 'co-a')
})

test('당사자 0명, 모르는 방향, 제목 없음, 없는 회사, 없는 딜은 쓰기 전에 거절한다', async () => {
  const cases: [Record<string, unknown>, (e: unknown) => boolean][] = [
    [{ direction: 'PURCHASE', title: 't', parties: [] }, failsWith('VALIDATION_FAILED', CONTRACT_PARTY_MSG.required)],
    [{ direction: 'LOAN', title: 't', parties: [VENDOR] }, failsWith('VALIDATION_FAILED', CONTRACT_MSG.badDirection)],
    [{ direction: 'PURCHASE', title: ' ', parties: [VENDOR] }, failsWith('VALIDATION_FAILED', CONTRACT_MSG.titleRequired)],
    [{ direction: 'PURCHASE', title: 't', parties: [{ ...VENDOR, companyId: 'other-ws' }] }, failsWith('VALIDATION_FAILED', CONTRACT_PARTY_MSG.companyNotFound)],
    [{ direction: 'PURCHASE', title: 't', dealId: 'nope', parties: [VENDOR] }, failsWith('VALIDATION_FAILED', CONTRACT_MSG.dealNotFound)],
  ]
  for (const [input, check] of cases) {
    const db = fakeDb()
    await assert.rejects(runAsCrmViewer('MEMBER', () => createContract(asDb(db), 'ws1', 'm1', { templateId: 'tpl', ...input })), check)
    assert.equal(db.store.contracts.length + db.store.parties.length, 0)
  }
})

test('있는 딜에 묶어 만들 수 있다', async () => {
  const db = fakeDb({ deals: ['d1'] })
  const { contract } = await runAsCrmViewer('MEMBER', () => createContract(asDb(db), 'ws1', 'm1', {
    direction: 'SALES', title: 't', templateId: 'tpl', dealId: 'd1', parties: [US, { role: 'CUSTOMER', snapshot: { name: '가람' } }],
  }))
  assert.equal(contract.dealId, 'd1')
})

test('회사 단위 계약은 관리자만 만든다', async () => {
  const input = { direction: 'CORPORATE', title: '사무실 임대', templateId: 'tpl', parties: [BUYER_US, { role: 'OTHER', snapshot: { name: '건물주' } }] }
  const db = fakeDb()
  await assert.rejects(runAsCrmViewer('MEMBER', () => createContract(asDb(db), 'ws1', 'm1', input)),
    failsWith('FORBIDDEN', CONTRACT_MSG.sensitivityDenied))
  assert.equal(db.store.parties.length, 0)
  const { contract } = await runAsCrmViewer('ADMIN', () => createContract(asDb(db), 'ws1', 'm1', input))
  assert.equal(contract.sensitivity, 'CORPORATE')
})

// ------------------------------------------------------------
// 3 견적에서 만들기의 당사자
// ------------------------------------------------------------

test('견적에서 만들면 공급자(우리)와 고객 두 당사자', () => {
  const doc = {
    supplier: { name: '주식회사 에이엑스', bizNo: '123-45-67890', ceo: '홍길동', address: '서울', phone: '' },
    customer: { companyName: '가람정보', personName: '박담당', phone: '02-000-0000' },
  } as unknown as QuoteDocument
  const ps: PartyInput[] = partiesFromQuote(doc, 'co-1')
  assert.deepEqual(ps, [
    { role: 'SUPPLIER', isSelf: true, companyId: null, snapshot: { name: '주식회사 에이엑스', ceo: '홍길동', bizNo: '123-45-67890', address: '서울' } },
    { role: 'CUSTOMER', isSelf: false, companyId: 'co-1', snapshot: { name: '가람정보', phone: '02-000-0000' } },
  ])
  const src = read('lib/crm/services/contract.ts')
  assert.match(src, /await writeParties\(tx, workspaceId, created\.id, partiesFromQuote\(doc, deal\?\.companyId \?\? null\)\)/)
})

// ------------------------------------------------------------
// 4 번호 셈
// ------------------------------------------------------------

test('번호 셈은 등급 거름망을 안 지나 회사 단위 계약 번호를 건너뛴다', async () => {
  const db = fakeDb()
  const corp = await runAsCrmViewer('ADMIN', () => createContract(asDb(db), 'ws1', 'a1', {
    direction: 'CORPORATE', title: '임대', templateId: 'tpl', parties: [BUYER_US],
  }))
  const mine = await runAsCrmViewer('MEMBER', () => createContract(asDb(db), 'ws1', 'm1', {
    direction: 'PURCHASE', title: 't', templateId: 'tpl', parties: [VENDOR],
  }))
  assert.notEqual(mine.contract.contractNo, corp.contract.contractNo)
  assert.ok(mine.contract.contractNo > corp.contract.contractNo, `${mine.contract.contractNo} > ${corp.contract.contractNo}`)
  assert.match(db.store.rawSql[0], /current_setting\('app\.workspace_id', true\)/)
  const fn = read('lib/crm/services/contract.ts').split('export async function nextContractNo')[1].split('\n}\n')[0]
  assert.doesNotMatch(fn, /c\(tx\)\.findFirst/, '모델 조회로 세면 거름망이 회사 단위 번호를 뺀다')
})
