/**
 * 조항 라이브러리 (P0184 I05)
 *
 *   1 새 조항은 버전 1 초안, 같은 키는 거절, 키 언어 제목 본문 검사, 본문은 정리기를 지남
 *   2 초안은 그 자리에서 고치고, 승인본을 고치면 다음 번호 초안이 새로 생기고 승인본은 그대로
 *   3 승인은 관리자만 — 서비스가 역할을 다시 본다, 문맥이 없으면 거절
 *   4 승인본은 지우지 않는다, 기준(approvedClause)은 가장 최근 승인본
 *   5 마이그레이션이 RLS 와 REVOKE 와 승인본 잠금 트리거를 같은 파일에서 건다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { approveClause, approvedClause, createClause, deleteClauseDraft, listClauses, updateClause } from './contract-clause.ts'
import { CrmError } from '../domain/errors.ts'
import { runAsCrmViewer } from '../domain/contract-sensitivity.ts'
import { CONTRACT_CLAUSE_MSG } from '../../terms/contract-doc.ts'

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..')
const failsWith = (code: string, message?: string) => (e: unknown) =>
  e instanceof CrmError && e.code === code && (message === undefined || e.message === message)

type Row = Record<string, unknown>

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => row[k] === v)
}

function fakeDb() {
  const store = { clauses: [] as Row[], audits: [] as Row[] }
  let seq = 0
  const sorted = (rows: Row[], orderBy?: unknown) => {
    const ob = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Record<string, 'asc' | 'desc'>[]
    return [...rows].sort((a, b) => {
      for (const o of ob) {
        const [k, dir] = Object.entries(o)[0]
        const x = a[k] as number | string, y = b[k] as number | string
        if (x !== y) return (x < y ? -1 : 1) * (dir === 'desc' ? -1 : 1)
      }
      return 0
    })
  }
  const apply = (row: Row, data: Row) => {
    for (const [k, v] of Object.entries(data)) {
      row[k] = v && typeof v === 'object' && 'increment' in (v as Row) ? (row[k] as number) + ((v as { increment: number }).increment) : v
    }
  }
  const db = {
    store,
    $transaction: async <R>(fn: (tx: unknown) => Promise<R>) => fn(db),
    $executeRawUnsafe: async () => 0,
    crmContractClause: {
      findFirst: async ({ where, orderBy }: { where: Row; orderBy?: unknown }) => {
        const r = sorted(store.clauses.filter((c) => matches(c, where)), orderBy)[0]
        return r ? { ...r } : null
      },
      findMany: async ({ where, orderBy }: { where: Row; orderBy?: unknown }) => sorted(store.clauses.filter((c) => matches(c, where)), orderBy).map((r) => ({ ...r })),
      create: async ({ data }: { data: Row }) => {
        const row = { id: `cl${++seq}`, approvedById: null, approvedAt: null, version: 0, updatedAt: new Date(0), ...data }
        store.clauses.push(row)
        return { ...row }
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = store.clauses.filter((c) => matches(c, where))
        // 트리거(마이그 326)처럼 승인본은 고치지 못한다
        if (rows.some((r) => r.status === 'APPROVED')) throw new Error('approved clause is locked')
        rows.forEach((r) => apply(r, data))
        return { count: rows.length }
      },
      deleteMany: async ({ where }: { where: Row }) => {
        const before = store.clauses.length
        store.clauses = store.clauses.filter((c) => !matches(c, where))
        return { count: before - store.clauses.length }
      },
    },
    crmAuditLog: { create: async ({ data }: { data: Row }) => { store.audits.push(data); return data } },
  }
  return db
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asDb = (d: ReturnType<typeof fakeDb>) => d as any
const NDA = { key: 'common.confidentiality', title: '제5조 (비밀유지)', html: '<p>각 당사자는 상대의 비밀을 지킨다.</p>' }

async function approvedOne(db: ReturnType<typeof fakeDb>) {
  const c = await createClause(asDb(db), 'ws1', 'm1', NDA)
  return runAsCrmViewer('ADMIN', () => approveClause(asDb(db), 'ws1', 'a1', c.id, c.version))
}

// ------------------------------------------------------------
// 1 만들기와 검사
// ------------------------------------------------------------

test('새 조항은 버전 1 초안이고 감사 한 줄을 남긴다', async () => {
  const db = fakeDb()
  const c = await createClause(asDb(db), 'ws1', 'm1', NDA)
  assert.deepEqual([c.key, c.lang, c.versionNo, c.status], ['common.confidentiality', 'ko', 1, 'DRAFT'])
  assert.equal(db.store.audits.length, 1)
  assert.equal(db.store.audits[0].action, 'contract_clause.created')
})

test('본문은 정리기를 지난다 — 스크립트와 이벤트 속성이 빠진다', async () => {
  const db = fakeDb()
  const c = await createClause(asDb(db), 'ws1', 'm1', { ...NDA, html: '<p onclick="x()">비밀<script>alert(1)</script></p>' })
  assert.equal(c.html, '<p>비밀</p>')
})

test('같은 키, 틀린 키, 모르는 언어, 빈 제목과 본문, 모르는 칸은 쓰기 전에 거절한다', async () => {
  const db = fakeDb()
  await createClause(asDb(db), 'ws1', 'm1', NDA)
  await assert.rejects(createClause(asDb(db), 'ws1', 'm1', NDA), failsWith('CONFLICT', CONTRACT_CLAUSE_MSG.keyTaken))
  const cases: [Row, string][] = [
    [{ ...NDA, key: 'Bad Key' }, CONTRACT_CLAUSE_MSG.badKey],
    [{ ...NDA, key: 'x', lang: 'jp' }, CONTRACT_CLAUSE_MSG.badLang],
    [{ ...NDA, key: 'y', title: '  ' }, CONTRACT_CLAUSE_MSG.titleRequired],
    [{ ...NDA, key: 'z', html: '<p> </p>' }, CONTRACT_CLAUSE_MSG.bodyRequired],
  ]
  for (const [input, msg] of cases) {
    await assert.rejects(createClause(asDb(db), 'ws1', 'm1', input), failsWith('VALIDATION_FAILED', msg))
  }
  await assert.rejects(createClause(asDb(db), 'ws1', 'm1', { ...NDA, key: 'w', html: '<p>{{없는.칸}}</p>' }), failsWith('VALIDATION_FAILED'))
  assert.equal(db.store.clauses.length, 1)
})

// ------------------------------------------------------------
// 2 고치기
// ------------------------------------------------------------

test('초안은 그 자리에서 고친다', async () => {
  const db = fakeDb()
  const c = await createClause(asDb(db), 'ws1', 'm1', NDA)
  const { clause, forked } = await updateClause(asDb(db), 'ws1', 'm1', c.id, c.version, { html: '<p>고친 글</p>' })
  assert.equal(forked, false)
  assert.equal(clause.id, c.id)
  assert.equal(clause.html, '<p>고친 글</p>')
  assert.equal(db.store.clauses.length, 1)
  await assert.rejects(updateClause(asDb(db), 'ws1', 'm1', c.id, c.version, { html: '<p>낡은 버전</p>' }), failsWith('CONFLICT', CONTRACT_CLAUSE_MSG.conflict))
})

test('승인된 본문을 고치면 다음 번호 초안이 새로 생기고 승인본은 그대로다', async () => {
  const db = fakeDb()
  const v1 = await approvedOne(db)
  const { clause, forked } = await updateClause(asDb(db), 'ws1', 'm1', v1.id, v1.version, { html: '<p>바꾼 비밀유지</p>' })
  assert.equal(forked, true)
  assert.notEqual(clause.id, v1.id)
  assert.deepEqual([clause.versionNo, clause.status, clause.html], [2, 'DRAFT', '<p>바꾼 비밀유지</p>'])
  const kept = db.store.clauses.find((r) => r.id === v1.id)!
  assert.deepEqual([kept.status, kept.html], ['APPROVED', NDA.html])
  // 초안이 이미 있으면 승인본을 또 고칠 수 없다
  await assert.rejects(updateClause(asDb(db), 'ws1', 'm1', v1.id, v1.version, { html: '<p>셋째</p>' }), failsWith('CONFLICT', CONTRACT_CLAUSE_MSG.draftExists))
})

// ------------------------------------------------------------
// 3 승인은 관리자만
// ------------------------------------------------------------

test('관리자가 아니면 서버가 승인을 거절한다, 문맥이 없어도 거절한다', async () => {
  for (const role of ['MEMBER', 'READONLY']) {
    const db = fakeDb()
    const c = await createClause(asDb(db), 'ws1', 'm1', NDA)
    await assert.rejects(runAsCrmViewer(role, () => approveClause(asDb(db), 'ws1', 'm1', c.id, c.version)),
      failsWith('FORBIDDEN', CONTRACT_CLAUSE_MSG.approveDenied))
    assert.equal(db.store.clauses[0].status, 'DRAFT')
  }
  const db = fakeDb()
  const c = await createClause(asDb(db), 'ws1', 'm1', NDA)
  await assert.rejects(approveClause(asDb(db), 'ws1', 'm1', c.id, c.version), failsWith('FORBIDDEN'))
})

test('관리자와 소유자는 승인한다, 승인 기록이 감사에 남는다, 승인본은 다시 승인하지 않는다', async () => {
  for (const role of ['ADMIN', 'OWNER']) {
    const db = fakeDb()
    const c = await createClause(asDb(db), 'ws1', 'm1', NDA)
    const a = await runAsCrmViewer(role, () => approveClause(asDb(db), 'ws1', 'a1', c.id, c.version))
    assert.deepEqual([a.status, a.approvedById], ['APPROVED', 'a1'])
    assert.ok(a.approvedAt instanceof Date)
    assert.equal(db.store.audits.at(-1)!.action, 'contract_clause.approved')
    await assert.rejects(runAsCrmViewer(role, () => approveClause(asDb(db), 'ws1', 'a1', a.id, a.version)),
      failsWith('VALIDATION_FAILED', CONTRACT_CLAUSE_MSG.notDraft))
  }
})

// ------------------------------------------------------------
// 4 지우기와 기준
// ------------------------------------------------------------

test('초안은 지우고 승인본은 안 지운다', async () => {
  const db = fakeDb()
  const v1 = await approvedOne(db)
  await assert.rejects(deleteClauseDraft(asDb(db), 'ws1', 'm1', v1.id), failsWith('VALIDATION_FAILED', CONTRACT_CLAUSE_MSG.notDraft))
  const { clause } = await updateClause(asDb(db), 'ws1', 'm1', v1.id, v1.version, { html: '<p>버릴 초안</p>' })
  await deleteClauseDraft(asDb(db), 'ws1', 'm1', clause.id)
  assert.deepEqual(db.store.clauses.map((r) => r.id), [v1.id])
})

test('기준은 가장 최근 승인본이고 초안만 있으면 없다', async () => {
  const db = fakeDb()
  const c = await createClause(asDb(db), 'ws1', 'm1', NDA)
  assert.equal(await approvedClause(asDb(db), NDA.key), null)
  const v1 = await runAsCrmViewer('ADMIN', () => approveClause(asDb(db), 'ws1', 'a1', c.id, c.version))
  const { clause: d2 } = await updateClause(asDb(db), 'ws1', 'm1', v1.id, v1.version, { html: '<p>둘째</p>' })
  assert.equal((await approvedClause(asDb(db), NDA.key))!.versionNo, 1)
  await runAsCrmViewer('ADMIN', () => approveClause(asDb(db), 'ws1', 'a1', d2.id, d2.version))
  assert.equal((await approvedClause(asDb(db), NDA.key))!.versionNo, 2)
  assert.deepEqual((await listClauses(asDb(db), { key: NDA.key })).map((r) => r.versionNo), [2, 1])
  assert.equal((await listClauses(asDb(db), { status: 'DRAFT' })).length, 0)
})

// ------------------------------------------------------------
// 5 마이그레이션
// ------------------------------------------------------------

test('마이그레이션이 같은 파일에서 RLS, REVOKE, 승인본 잠금을 건다', () => {
  const sql = readFileSync(join(ROOT, 'supabase/migrations/326_contract_clause_library.sql'), 'utf8')
  assert.match(sql, /ALTER TABLE crm_contract_clause ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON crm_contract_clause FROM anon, authenticated/)
  assert.match(sql, /BEFORE UPDATE OR DELETE ON crm_contract_clause/)
  assert.match(sql, /SET search_path = public, pg_temp/)
})
