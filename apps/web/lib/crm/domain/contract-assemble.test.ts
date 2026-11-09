/**
 * 계약 모듈과 조립 (P0184 I06)
 *
 *   1 모듈 종류 넷, 공통 + 고른 모듈 → 조항 배열, 조 번호가 이어서 매겨지고 부속서는 따로 센다
 *   2 급부 여럿(물품 + SW 사용권 + 유지보수), 같은 조항 키는 한 번만
 *   3 켜는 조건(방향, 사업 유형, 칸 값)이 데이터로 판정된다, 규제는 조건이 정한다
 *   4 조건 검사: 모르는 칸, 모양 틀림 거절
 *   5 본문 없는 키는 모아 돌려준다, 마이그레이션이 RLS 와 REVOKE 를 같은 파일에서 건다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { MODULE_KINDS, checkCondition, conditionHolds, selectModules, ModuleInputError, type ContractModule, type ModuleContext } from './contract-module.ts'
import { assembleContract, bareTitle, type ClauseText } from './contract-assemble.ts'
import { normalizeClauses } from './contract-body.ts'

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..')

const mod = (key: string, kind: ContractModule['kind'], position: number, clauseKeys: string[], enableWhen: ContractModule['enableWhen'] = null): ContractModule =>
  ({ key, kind, title: key, clauseKeys, enableWhen, position })

const TEXTS = new Map<string, ClauseText>([
  ['purpose', { title: '제1조 (목적)', html: '<p>목적</p>' }],
  ['definition', { title: '정의', html: '<p>정의</p>' }],
  ['goods.delivery', { title: '납품', html: '<p>납품</p>' }],
  ['inspection', { title: '검수', html: '<p>검수</p>' }],
  ['sw.license', { title: '사용권', html: '<p>사용권</p>' }],
  ['maint.sla', { title: '유지보수 수준', html: '<p>SLA</p>' }],
  ['pay.lump', { title: '대금 지급', html: '<p>일시</p>' }],
  ['credit.custody', { title: '크레딧 별도관리', html: '<p>별도관리</p>' }],
  ['confidentiality', { title: '비밀유지', html: '<p>비밀</p>' }],
  ['law', { title: '준거법', html: '<p>준거법</p>' }],
  ['annex.spec', { title: '사양서', html: '<p>사양</p>' }],
])

const COMMON_HEAD = mod('common.head', 'COMMON', 0, ['purpose', 'definition'])
const COMMON_TAIL = mod('common.tail', 'COMMON', 90, ['confidentiality', 'law'])
const GOODS = mod('perf.goods', 'PERFORMANCE', 10, ['goods.delivery', 'inspection'])
const SW = mod('perf.sw', 'PERFORMANCE', 11, ['sw.license', 'inspection'])
const MAINT = mod('perf.maint', 'PERFORMANCE', 12, ['maint.sla'])
const LUMP = mod('pay.lump', 'CONSIDERATION', 30, ['pay.lump'])
const CREDIT_REG = mod('reg.credit', 'REGULATION', 50, ['credit.custody'], {
  all: [{ field: 'direction', op: 'in', values: ['SALES'] }, { field: 'businessTypeKey', op: 'in', values: ['gpu_rental'] }, { field: 'value.credit.amount', op: 'truthy' }],
})
const SPEC = mod('annex.spec', 'ANNEX', 1, ['annex.spec'])
const ALL = [SPEC, MAINT, LUMP, COMMON_TAIL, GOODS, CREDIT_REG, SW, COMMON_HEAD]

const SALES_CTX: ModuleContext = { direction: 'SALES', businessTypeKey: 'hw_sale', values: {} }

// ------------------------------------------------------------
// 1 종류와 조립
// ------------------------------------------------------------

test('고르는 모듈 종류는 넷이다', () => {
  assert.deepEqual([...MODULE_KINDS], ['PERFORMANCE', 'CONSIDERATION', 'REGULATION', 'ANNEX'])
})

test('공통 + 고른 모듈을 position 순으로 조립하고 조 번호를 이어 매긴다, 부속서는 맨 뒤에서 따로 센다', () => {
  const chosen = selectModules(ALL, ['perf.goods', 'pay.lump', 'annex.spec'], SALES_CTX)
  const { clauses, missing } = assembleContract(chosen, TEXTS)
  assert.deepEqual(missing, [])
  assert.deepEqual(clauses.map((c) => c.title), [
    '제1조 (목적)', '제2조 (정의)', '제3조 (납품)', '제4조 (검수)', '제5조 (대금 지급)', '제6조 (비밀유지)', '제7조 (준거법)', '부속서 1. 사양서',
  ])
  assert.ok(clauses.every((c) => c.origin === 'template'))
  // 조립 결과가 계약서 조항 정리기를 그대로 통과한다 (id 모양, 겹침 없음)
  assert.equal(normalizeClauses(clauses).length, clauses.length)
})

test('저장된 제목의 번호는 떼고 조립이 다시 매긴다', () => {
  assert.equal(bareTitle('제12조 (손해배상)'), '손해배상')
  assert.equal(bareTitle('제 3 조 목적'), '목적')
  assert.equal(bareTitle('비밀유지'), '비밀유지')
})

// ------------------------------------------------------------
// 2 급부 여럿과 겹침
// ------------------------------------------------------------

test('물품 + SW 사용권 + 유지보수를 함께 고르면 검수는 한 번만 들어간다', () => {
  const chosen = selectModules(ALL, ['perf.goods', 'perf.sw', 'perf.maint', 'pay.lump'], SALES_CTX)
  const { clauses } = assembleContract(chosen, TEXTS)
  assert.deepEqual(clauses.map((c) => c.id), [
    'purpose', 'definition', 'goods-delivery', 'inspection', 'sw-license', 'maint-sla', 'pay-lump', 'confidentiality', 'law',
  ])
  assert.equal(clauses.filter((c) => c.id === 'inspection').length, 1)
})

test('점과 줄표만 다른 키는 id 가 겹치지 않게 번호를 붙인다', () => {
  const texts = new Map([['a.b', { title: '가', html: '<p>가</p>' }], ['a-b', { title: '나', html: '<p>나</p>' }]])
  const { clauses } = assembleContract([mod('m', 'COMMON', 0, ['a.b', 'a-b'])], texts)
  assert.deepEqual(clauses.map((c) => c.id), ['a-b', 'a-b-2'])
})

// ------------------------------------------------------------
// 3 켜는 조건
// ------------------------------------------------------------

test('규제 모듈은 방향, 사업 유형, 칸 값이 모두 맞을 때만 켜진다', () => {
  const on: ModuleContext = { direction: 'SALES', businessTypeKey: 'gpu_rental', values: { 'credit.amount': '1000000' } }
  assert.equal(conditionHolds(CREDIT_REG.enableWhen, on), true)
  assert.equal(conditionHolds(CREDIT_REG.enableWhen, { ...on, direction: 'PURCHASE' }), false)
  assert.equal(conditionHolds(CREDIT_REG.enableWhen, { ...on, businessTypeKey: 'hw_sale' }), false)
  assert.equal(conditionHolds(CREDIT_REG.enableWhen, { ...on, values: { 'credit.amount': '0' } }), false)
  assert.equal(conditionHolds(CREDIT_REG.enableWhen, { ...on, values: {} }), false)

  const keys = (ctx: ModuleContext, chosen: string[]) => selectModules(ALL, chosen, ctx).map((m) => m.key)
  assert.ok(keys(on, []).includes('reg.credit'), '안 골라도 조건이 맞으면 들어간다')
  assert.ok(!keys({ ...on, direction: 'PURCHASE' }, ['reg.credit']).includes('reg.credit'), '조건 있는 규제는 골라도 조건이 정한다')
})

test('notIn 과 조건 없는 모듈', () => {
  const cond = checkCondition({ all: [{ field: 'direction', op: 'notIn', values: ['CORPORATE'] }] })
  assert.equal(conditionHolds(cond, SALES_CTX), true)
  assert.equal(conditionHolds(cond, { ...SALES_CTX, direction: 'CORPORATE' }), false)
  assert.equal(conditionHolds(null, SALES_CTX), false)
  // 조건 없는 급부는 골랐을 때만
  assert.ok(!selectModules(ALL, [], SALES_CTX).some((m) => m.key === 'perf.goods'))
})

// ------------------------------------------------------------
// 4 조건 검사
// ------------------------------------------------------------

test('조건 검사: 모르는 칸, 모르는 연산, 빈 값 목록, 모양 틀림을 거절하고 정리된 새 객체를 돌려준다', () => {
  for (const bad of [
    { all: [{ field: 'role', op: 'in', values: ['x'] }] },
    { all: [{ field: 'direction', op: 'eq', values: ['x'] }] },
    { all: [{ field: 'direction', op: 'in', values: [] }] },
    { all: [{ field: 'direction', op: 'in', values: [1] }] },
    { any: [] },
    'direction=SALES',
  ]) {
    assert.throws(() => checkCondition(bad), ModuleInputError)
  }
  const raw = { all: [{ field: 'value.credit.amount', op: 'truthy', values: ['ignored'], extra: 1 }] }
  const c = checkCondition(raw)
  assert.deepEqual(c, { all: [{ field: 'value.credit.amount', op: 'truthy' }] })
  assert.notEqual(c, raw)
  assert.equal(checkCondition(null), null)
})

// ------------------------------------------------------------
// 5 본문 없음과 마이그레이션
// ------------------------------------------------------------

test('승인본이 없는 키는 빼고 모아서 돌려준다', () => {
  const { clauses, missing } = assembleContract([mod('m', 'COMMON', 0, ['purpose', 'nope.one', 'nope.two'])], TEXTS)
  assert.deepEqual(missing, ['nope.one', 'nope.two'])
  assert.equal(clauses.length, 1)
})

test('마이그레이션이 같은 파일에서 RLS 와 REVOKE 를 건다', () => {
  const sql = readFileSync(join(ROOT, 'supabase/migrations/327_contract_module.sql'), 'utf8')
  assert.match(sql, /ALTER TABLE crm_contract_module ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON crm_contract_module FROM anon, authenticated/)
  assert.match(sql, /'COMMON', 'PERFORMANCE', 'CONSIDERATION', 'REGULATION', 'ANNEX'/)
})
