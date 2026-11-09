/**
 * 표준 이탈 판정과 관리자 승인 (P0184 I08)
 *
 *   1 라이브러리 승인본과 다르거나, origin 이 manual ai 이면 이탈. 템플릿에서 빠진 조항도 이탈
 *   2 공백과 빈 문단만 다르면 같다, 조립이 매긴 번호는 견주지 않는다
 *   3 이탈이 있는 버전은 같은 버전 같은 지문의 승인이 있어야 체결된다, 본문이 바뀌면 승인 무효
 *   4 승인은 관리자만 — 서버 판정, 승인 기록과 감사 로그가 남는다, 이탈이 없으면 승인할 것이 없다
 *   5 체결(changeContractStatus)이 트랜잭션 안에서 관문을 지난다, 마이그레이션 잠금
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { canConcludeWith, detectDeviations, type DeviationBaseline } from './contract-deviation.ts'
import { assertDeviationsApproved, approveContractDeviations, readDeviationState } from '../services/contract-deviation.ts'
import { contentHash, type Clause } from './contract-body.ts'
import { CrmError } from './errors.ts'
import { CONTRACT_DEVIATION_MSG } from '../../terms/contract-doc.ts'

const WEB = join(import.meta.dirname, '..', '..', '..')
const ROOT = join(WEB, '..', '..')

const LIB: DeviationBaseline['library'] = new Map([
  ['common-confidentiality', { title: '비밀유지', html: '<p>각 당사자는 비밀을 지킨다.</p>' }],
  ['common-liability', { title: '책임 한도', html: '<p>손해배상은 계약금액을 넘지 않는다.</p>' }],
])
const TEMPLATE: Clause[] = [
  { id: 'c1', title: '제1조 (목적)', html: '<p>{{계약.수행범위}}</p>', origin: 'template' },
  { id: 'c2', title: '제2조 (해지)', html: '<p>30일 전 통지로 해지한다.</p>', origin: 'template' },
]
const STANDARD: Clause[] = [
  ...TEMPLATE,
  { id: 'common-confidentiality', title: '제3조 (비밀유지)', html: '<p>각 당사자는 비밀을 지킨다.</p>', origin: 'template' },
  { id: 'common-liability', title: '제4조 (책임 한도)', html: '<p>손해배상은 계약금액을 넘지 않는다.</p>', origin: 'template' },
]
const BASE: DeviationBaseline = { library: LIB, template: TEMPLATE }

// ------------------------------------------------------------
// 1 2 판정
// ------------------------------------------------------------

test('표준 그대로면 이탈이 없다 — 공백, 빈 문단, 조립 번호 차이는 같다', () => {
  assert.deepEqual(detectDeviations(STANDARD, BASE), [])
  const reflowed = STANDARD.map((c) => c.id === 'common-liability'
    ? { ...c, title: '제9조 (책임 한도)', html: '<p>손해배상은   계약금액을 넘지 않는다.</p><p></p>' } : c)
  assert.deepEqual(detectDeviations(reflowed, BASE), [])
})

test('라이브러리 승인본과 다른 글, AI 조항, 새로 넣은 조항, 표준에 없는 조항, 빠진 템플릿 조항은 이탈이다', () => {
  const body: Clause[] = [
    TEMPLATE[0],
    { ...STANDARD[2] },
    { ...STANDARD[3], html: '<p>손해배상은 계약금액의 3배를 넘지 않는다.</p>' },
    { id: 'c9', title: '특약', html: '<p>AI 가 쓴 특약</p>', origin: 'ai' },
    { id: 'c10', title: '추가', html: '<p>사람이 넣음</p>', origin: 'manual' },
    { id: 'c11', title: '출처 모름', html: '<p>?</p>', origin: 'template' },
  ]
  assert.deepEqual(detectDeviations(body, BASE).map((d) => [d.clauseId, d.reason]), [
    ['common-liability', 'changed'], ['c9', 'ai'], ['c10', 'manual'], ['c11', 'unknown'], ['c2', 'removed'],
  ])
})

test('템플릿 조항의 글을 고쳐도 이탈이다 (origin 이 template 로 남아 있어도)', () => {
  const body = STANDARD.map((c) => (c.id === 'c2' ? { ...c, html: '<p>통지 없이 해지한다.</p>' } : c))
  assert.deepEqual(detectDeviations(body, BASE).map((d) => d.reason), ['changed'])
})

// ------------------------------------------------------------
// 3 체결 판정
// ------------------------------------------------------------

test('이탈이 있으면 같은 버전 같은 지문의 승인이 있어야 체결된다', () => {
  const dev = detectDeviations([{ id: 'x', title: 'x', html: '<p>x</p>', origin: 'ai' }], BASE)
  const v = { versionNo: 3, contentHash: 'h3' }
  assert.equal(canConcludeWith([], v, null), true)
  assert.equal(canConcludeWith(dev, v, null), false)
  assert.equal(canConcludeWith(dev, v, { versionNo: 3, contentHash: 'h3' }), true)
  assert.equal(canConcludeWith(dev, { versionNo: 4, contentHash: 'h4' }, { versionNo: 3, contentHash: 'h3' }), false, '승인 뒤 새 버전')
  assert.equal(canConcludeWith(dev, v, { versionNo: 3, contentHash: 'other' }), false, '같은 번호라도 지문이 다르면')
})

// ------------------------------------------------------------
// 4 승인 서비스 — 가짜 DB
// ------------------------------------------------------------

type Row = Record<string, unknown>

function fakeDb(body: Clause[]) {
  const hash = contentHash(body, {})
  const store = {
    contract: { id: 'k1', templateId: 'tpl', currentVersionNo: 2, status: 'DRAFT', version: 5 } as Row,
    approvals: [] as Row[],
    audits: [] as Row[],
  }
  const db = {
    store, hash,
    $transaction: async <R>(fn: (tx: unknown) => Promise<R>) => fn(db),
    $executeRawUnsafe: async () => 0,
    crmContract: {
      findFirst: async () => ({
        dealId: null, direction: 'SALES', formOwner: 'OURS', docLayer: 'STANDALONE', sensitivity: 'SALES', quoteId: null,
        contractNo: 'CT-1', title: 't', parentContractId: null, sentAt: null, sentVersionNo: null, concludedAt: null,
        totalMinor: null, currency: null, createdAt: new Date(0), updatedAt: new Date(0), ...store.contract,
      }),
    },
    crmContractVersion: { findFirst: async () => ({ versionNo: 2, body, contentHash: hash, templateVersionNo: 1 }) },
    crmContractTemplateVersion: { findFirst: async () => ({ body: TEMPLATE }) },
    crmContractClause: {
      findMany: async () => [...LIB].map(([id, t]) => ({ key: id.replace('-', '.'), lang: 'ko', ...t })),
    },
    crmContractDeviationApproval: {
      findFirst: async ({ where }: { where: Row }) => store.approvals.find((a) => a.contractId === where.contractId && a.versionNo === where.versionNo) ?? null,
      create: async ({ data }: { data: Row }) => {
        const row = { approvedAt: new Date(0), ...data }
        store.approvals.push(row)
        return row
      },
    },
    crmAuditLog: { create: async ({ data }: { data: Row }) => { store.audits.push(data); return data } },
  }
  return db
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asDb = (d: unknown) => d as any
const DEVIANT: Clause[] = [...STANDARD, { id: 'c9', title: '특약', html: '<p>AI 특약</p>', origin: 'ai' }]
const code = (c: string, message?: string) => (e: unknown) => e instanceof CrmError && e.code === c && (message === undefined || e.message === message)

test('관리자가 아니면 서버가 승인을 거절한다', async () => {
  for (const role of ['MEMBER', 'READONLY'] as const) {
    const db = fakeDb(DEVIANT)
    await assert.rejects(approveContractDeviations(asDb(db), 'ws1', { memberId: 'm1', role }, 'k1', 5),
      code('FORBIDDEN', CONTRACT_DEVIATION_MSG.approveDenied))
    assert.equal(db.store.approvals.length, 0)
  }
})

test('이탈이 있는 버전은 승인 전 체결 거절, 관리자가 승인하면 체결 관문을 지나고 승인 기록과 감사가 남는다', async () => {
  const db = fakeDb(DEVIANT)
  const contract = { id: 'k1', templateId: 'tpl', currentVersionNo: 2 }
  await assert.rejects(assertDeviationsApproved(asDb(db), contract), code('VALIDATION_FAILED', CONTRACT_DEVIATION_MSG.needsApproval(1)))
  const state = await approveContractDeviations(asDb(db), 'ws1', { memberId: 'a1', role: 'ADMIN' }, 'k1', 5, ' 법무 확인 ')
  assert.equal(state.canConclude, true)
  assert.deepEqual(db.store.approvals[0], {
    contractId: 'k1', versionNo: 2, contentHash: db.hash, deviations: [{ clauseId: 'c9', reason: 'ai' }],
    note: '법무 확인', approvedById: 'a1', approvedAt: new Date(0),
  })
  assert.equal(db.store.audits.at(-1)!.action, 'contract.deviation_approved')
  await assertDeviationsApproved(asDb(db), contract)
  await assert.rejects(approveContractDeviations(asDb(db), 'ws1', { memberId: 'a1', role: 'OWNER' }, 'k1', 5), code('CONFLICT', CONTRACT_DEVIATION_MSG.alreadyApproved))
})

test('승인 뒤 본문이 바뀌면 (지문이 다르면) 승인은 효력이 없다', async () => {
  const db = fakeDb(DEVIANT)
  await approveContractDeviations(asDb(db), 'ws1', { memberId: 'a1', role: 'ADMIN' }, 'k1', 5)
  db.store.approvals[0].contentHash = 'hash-of-older-body'
  const state = await readDeviationState(asDb(db), { id: 'k1', templateId: 'tpl', currentVersionNo: 2 })
  assert.equal(state.canConclude, false)
})

test('이탈이 없으면 승인할 것이 없고 체결 관문은 그냥 지난다, 체결한 계약은 승인하지 않는다', async () => {
  const db = fakeDb(STANDARD)
  await assertDeviationsApproved(asDb(db), { id: 'k1', templateId: 'tpl', currentVersionNo: 2 })
  await assert.rejects(approveContractDeviations(asDb(db), 'ws1', { memberId: 'a1', role: 'ADMIN' }, 'k1', 5), code('VALIDATION_FAILED', CONTRACT_DEVIATION_MSG.noDeviations))
  const done = fakeDb(DEVIANT)
  done.store.contract.status = 'CONCLUDED'
  await assert.rejects(approveContractDeviations(asDb(done), 'ws1', { memberId: 'a1', role: 'ADMIN' }, 'k1', 5), code('INVALID_TRANSITION'))
})

// ------------------------------------------------------------
// 5 결선과 잠금
// ------------------------------------------------------------

test('★ 체결이 트랜잭션 안에서 이탈 관문을 지난 뒤에 상태를 바꾼다', () => {
  const sign = readFileSync(join(WEB, 'lib/crm/services/contract-sign.ts'), 'utf8')
  const gate = sign.indexOf("if (action === 'conclude') await assertDeviationsApproved(tx, contract)")
  assert.ok(gate > 0, '체결 관문이 없다')
  assert.ok(gate > sign.indexOf('return withCrmTx'), '트랜잭션 안')
  assert.ok(gate < sign.indexOf('crmContract.updateMany'), '상태를 바꾸기 전')
})

test('마이그레이션이 RLS, REVOKE, 승인 기록 잠금을 같은 파일에서 건다', () => {
  const sql = readFileSync(join(ROOT, 'supabase/migrations/328_contract_deviation_approval.sql'), 'utf8')
  assert.match(sql, /ALTER TABLE crm_contract_deviation_approval ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON crm_contract_deviation_approval FROM anon, authenticated/)
  assert.match(sql, /BEFORE UPDATE OR DELETE ON crm_contract_deviation_approval/)
  assert.match(sql, /ON DELETE CASCADE/)
})
