/**
 * 계약서 만들기 고치기 버전 비교 (P0132 I08)
 *
 * **버전은 한 번 쓰면 고치지 않는다.** 그 약속이 세 겹에 걸려 있는지 본다
 *   1 판정: 초안 견적 거절, 같은 내용은 버전 0개, version 이 어긋나면 CONFLICT (planSave)
 *   2 서비스: 고치기가 견적을 다시 읽지 않고 버전의 스냅샷을 이어 쓴다
 *   3 DB: 버전 표 UPDATE 를 트리거가 거절한다 (contract-lock.test.ts, 실측은 pass notes)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  assertContractableQuote, checkManualFields, nextFieldValues, renderClauses, planSave, manualOf, planRefill,
} from './contract.ts'
import { autoValuesFrom, mergeFieldValues, fieldToken, type FieldValues } from '../domain/contract-fields.ts'
import { contentHash, type Clause } from '../domain/contract-body.ts'
import { CrmError } from '../domain/errors.ts'
import type { QuoteDocument } from '../domain/quote-document.ts'
import { CONTRACT_FIELD_LABEL, CONTRACT_MSG, EMPTY_FIELD } from '../../terms/contract-doc.ts'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const SERVICE = read('lib/crm/services/contract.ts')
const tok = (key: string) => fieldToken(CONTRACT_FIELD_LABEL[key])
const code = (c: string) => (e: unknown) => e instanceof CrmError && e.code === c

// 합성 견본 — 고객 값은 지어낸 것이다
const DOC = {
  supplier: { name: '주식회사 에이엑스', bizNo: '123-45-67890', ceo: '홍길동', address: '서울' },
  owner: { name: '김영업' },
  customer: { companyName: '주식회사 <한빛>', personName: '박담당님' },
  meta: { quoteNo: 'DA-20261016-01', title: 'GPU 증설', issuedOn: '2026-10-16', currency: 'KRW' },
  lines: [{ no: 1, name: 'H100 서버', unit: '대', quantity: '2', duration: null, unitPriceMinor: '1', amountMinor: '1', rate: { start: '2026-11-01', end: '2027-04-30' } }],
  totals: { netTotalMinor: '17500000', taxMinor: '1750000', totalMinor: '19250000', totalInWords: '금 일천구백이십오만원정' },
  terms: [],
} as unknown as QuoteDocument

const BODY: Clause[] = [
  { id: 'c1', title: '제1조 (당사자)', html: `<p>${tok('supplier.name')}(이하 갑)와 ${tok('customer.name')}(이하 을)</p>` },
  { id: 'c2', title: '제2조 (대금)', html: `<p>계약 금액은 ${tok('quote.total')}으로 한다. 대표 ${tok('customer.ceo')}</p>` },
]

function version1(manual: Record<string, string> = {}) {
  const fieldValues = mergeFieldValues(autoValuesFrom(DOC, 'CT-20261018-01'), manual)
  return { body: BODY, fieldValues, quoteSnapshot: DOC, contentHash: contentHash(BODY, fieldValues) }
}
const CONTRACT = { status: 'DRAFT', version: 3, title: 'GPU 증설 계약서', contractNo: 'CT-20261018-01' }
const NONE = { body: null, patch: {} }

/* ── 어떤 견적으로 만들 수 있나 ─────────────────────── */

test('★ 작성 중 견적으로는 계약서를 만들지 않는다', () => {
  assert.throws(() => assertContractableQuote({ status: 'DRAFT' }), code('INVALID_TRANSITION'))
  assert.throws(() => assertContractableQuote({ status: 'REJECTED' }), code('INVALID_TRANSITION'))
  assert.throws(() => assertContractableQuote({ status: 'SENT', expired: true }), code('INVALID_TRANSITION'))
  assert.doesNotThrow(() => assertContractableQuote({ status: 'SENT', expired: false }))
  assert.doesNotThrow(() => assertContractableQuote({ status: 'ACCEPTED' }))
})

test('★ 만들기는 상태 판정을 견적 문서를 읽기 전에 부른다', () => {
  const fn = SERVICE.slice(SERVICE.indexOf('export async function createContractFromQuote'))
  const guard = fn.indexOf('assertContractableQuote(')
  assert.ok(guard > 0, '상태 판정을 안 부른다')
  assert.ok(guard < fn.indexOf('getQuoteDocument('), '견적 문서를 먼저 읽는다')
})

/* ── 사람이 넣는 칸 ─────────────────────────────── */

test('사람이 넣는 칸 — 모르는 칸, 블록 칸, 계약서 번호, 너무 긴 값은 거절한다', () => {
  assert.deepEqual(checkManualFields({ 'customer.ceo': ' 이대표 ' }), { 'customer.ceo': '이대표' })
  assert.throws(() => checkManualFields({ 'customer.ceoo': 'x' }), code('VALIDATION_FAILED'))
  assert.throws(() => checkManualFields({ 'quote.lines': 'x' }), code('VALIDATION_FAILED'))
  assert.throws(() => checkManualFields({ 'contract.no': 'X-1' }), code('VALIDATION_FAILED'))
  assert.throws(() => checkManualFields({ 'customer.ceo': 'x'.repeat(501) }), code('VALIDATION_FAILED'))
  assert.throws(() => checkManualFields(['x']), code('VALIDATION_FAILED'))
})

test('빈 값을 보내면 그 칸은 자동으로 돌아가고, 안 보낸 칸은 그대로다', () => {
  const auto = autoValuesFrom(DOC, 'CT-1')
  const prev = mergeFieldValues(auto, { 'customer.name': '바꾼 상호', 'customer.ceo': '이대표' })
  const next = nextFieldValues(prev, auto, { 'customer.name': '' })
  assert.deepEqual(next['customer.name'], { value: '주식회사 <한빛>', source: 'auto' })
  assert.deepEqual(next['customer.ceo'], { value: '이대표', source: 'manual' })
  assert.deepEqual(manualOf(prev), { 'customer.name': '바꾼 상호', 'customer.ceo': '이대표' })
})

/* ── 종이에 그리기 ──────────────────────────────── */

test('★ 저장 본문은 칸 자리를 남기고, 그릴 때만 채운다 — 값은 escape, 빈 칸은 (미입력)', () => {
  const v = version1()
  const out = renderClauses(v.body, v.fieldValues, DOC)
  assert.match(out[0].html, /주식회사 에이엑스\(이하 갑\)와 주식회사 &lt;한빛&gt;/)
  assert.match(out[1].html, /19,250,000원/)
  assert.ok(out[1].html.includes(EMPTY_FIELD), '빈 대표자 칸이 드러나지 않는다')
  assert.ok(BODY[0].html.includes(tok('customer.name')), '그리기가 저장 본문을 바꿨다')
})

/* ── 고치기 판정 ────────────────────────────────── */

test('★ 같은 내용 저장은 버전을 만들지 않는다', () => {
  const cur = version1()
  assert.equal(planSave(CONTRACT, cur, 3, NONE).action, 'noop')
  // 같은 본문을 새 배열로 보내도 지문이 같으면 버전이 없다
  assert.equal(planSave(CONTRACT, cur, 3, { body: BODY.map((x) => ({ ...x })), patch: {} }).action, 'noop')
})

test('★ version 이 어긋나면 CONFLICT — 남이 먼저 고친 것을 덮지 않는다', () => {
  assert.throws(() => planSave(CONTRACT, version1(), 2, NONE), (e: unknown) => code('CONFLICT')(e) && (e as Error).message === CONTRACT_MSG.conflict)
})

test('★ 체결한 계약서는 고치지 않는다', () => {
  for (const status of ['CONCLUDED', 'TERMINATED', 'CANCELLED']) {
    assert.throws(() => planSave({ ...CONTRACT, status }, version1(), 3, NONE), code('INVALID_TRANSITION'))
  }
})

test('본문이나 칸 값이 바뀌면 새 버전, 제목만 바뀌면 버전 없이 제목만', () => {
  const cur = version1()
  const edited = [BODY[0], { ...BODY[1], html: '<p>계약 금액은 별도로 정한다.</p>' }]
  const a = planSave(CONTRACT, cur, 3, { body: edited, patch: {} })
  assert.equal(a.action, 'version')
  assert.notEqual(a.action === 'version' && a.hash, cur.contentHash)

  const b = planSave(CONTRACT, cur, 3, { body: null, patch: { 'customer.ceo': '이대표' } })
  assert.equal(b.action, 'version')
  assert.equal(b.action === 'version' && b.fieldValues['customer.ceo'].source, 'manual')

  assert.equal(planSave(CONTRACT, cur, 3, { body: null, patch: {}, title: '새 제목' }).action, 'title')
})

test('★ 만든 뒤 견적을 고쳐도 고치기는 버전의 스냅샷으로 자동 칸을 만든다', () => {
  // 견적 합계가 바뀐 뒤라도, 고치기 판정은 이 버전이 든 견적 스냅샷만 본다
  const cur = version1()
  const plan = planSave(CONTRACT, cur, 3, { body: null, patch: { 'customer.ceo': '이대표' } })
  assert.equal(plan.action === 'version' && plan.fieldValues['quote.total'].value, '19,250,000원')
  // 서비스가 고치기 안에서 견적을 다시 읽지 않는다
  const save = SERVICE.slice(SERVICE.indexOf('export async function saveContractVersion'), SERVICE.indexOf('export async function createAmendment'))
  assert.ok(!/getQuote(Document)?\(/.test(save), '고치기가 견적을 다시 읽는다 — 스냅샷이 몰래 바뀐다')
  assert.match(save, /quoteSnapshot: cur\.quoteSnapshot/, '다음 버전이 앞 버전의 스냅샷을 잇지 않는다')
})

/* ── 굳히는 것 ──────────────────────────────────── */

test('★ 만들기가 견적 문서, 서명란 설정, 견적 버전을 버전 1 에 굳힌다', () => {
  const fn = SERVICE.slice(SERVICE.indexOf('export async function createContractFromQuote'), SERVICE.indexOf('function pickCustomer'))
  for (const want of ['quoteSnapshot: doc', 'signatureSnapshot: signature', 'sourceQuoteVersion: quote.version', 'templateVersionNo', "kind: 'GENERATED'"]) {
    assert.ok(fn.includes(want), `버전 1 에 ${want} 가 없다`)
  }
  assert.match(fn, /readContractSignature\(db\)/)
  assert.match(fn, /readContractNoPattern\(db\)/)
  // 본문은 정리기를 지난다
  assert.match(fn, /checkClauses\(templateBody\)/)
})

test('서명란과 번호 설정 키를 계약서 서비스가 읽는다', () => {
  for (const key of ['contract.numberFormat', 'contract.sign.partyA', 'contract.sign.partyB', 'contract.sign.mark', 'contract.sign.showCeo']) {
    assert.ok(SERVICE.includes(`resolveSetting(db, '${key}')`), `${key} 를 안 읽는다`)
  }
})

/* ── 창구 ──────────────────────────────────────── */

function routes(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...routes(full))
    else if (name === 'route.ts') out.push(full)
  }
  return out
}

test('★ 계약서 라우트는 전부 withCrmApi MEMBER 를 지난다', () => {
  const files = routes(join(ROOT, 'app/api/crm/contracts'))
  assert.ok(files.length >= 4, `라우트를 못 찾았다(${files.length})`)
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    const handlers = [...src.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)].length
    const guarded = [...src.matchAll(/withCrmApi\('MEMBER'/g)].length
    assert.ok(handlers > 0, `${f} 에 처리기가 없다`)
    assert.equal(guarded, handlers, `${f} 처리기 ${handlers}개 중 MEMBER 관문 ${guarded}개`)
  }
})

test('만들기는 워크스페이스 가드가 걸린 연결로 견적을 읽는다 — 남의 견적 id 는 「찾을 수 없음」', () => {
  const route = read('app/api/crm/contracts/route.ts')
  assert.match(route, /createContractFromQuote\(db, session\.workspaceId/)
  const fn = SERVICE.slice(SERVICE.indexOf('export async function createContractFromQuote'))
  assert.match(fn, /getQuote\(db, quoteId\)/)
  assert.ok(!/getCrmDb|\$queryRaw/.test(SERVICE), '가드를 지나지 않는 연결을 쓴다')
})

// 시험이 지어낸 값이 저장소에 안 남는다
test('fieldValues 견본 모양', () => {
  const fv: FieldValues = version1().fieldValues
  assert.equal(fv['contract.no'].value, 'CT-20261018-01')
})

/* ── 견적 변경 알림과 다시 채우기 (I11) ─────────────── */

const DOC2 = {
  ...DOC,
  customer: { companyName: '주식회사 한빛 시스템', personName: '박담당님' },
  totals: { ...DOC.totals, totalMinor: '22000000' },
  terms: ['납품 후 30일 안 지급'],
} as unknown as QuoteDocument

test('★ 견적이 바뀌면 바뀐 칸 목록을 낸다 — 블록 칸(거래 조건)까지', () => {
  const plan = planRefill(version1(), DOC2, CONTRACT.contractNo)
  // 품목표는 합계 줄을 싣기에 합계가 바뀌면 같이 바뀐다
  assert.deepEqual([...plan.changed].sort(), ['customer.name', 'quote.lines', 'quote.terms', 'quote.total'])
  assert.deepEqual(planRefill(version1(), DOC, CONTRACT.contractNo).changed, [], '안 바뀐 견적은 바뀐 칸 0')
})

test('★ 다시 채우기는 자동 칸만 바꾸고 사람이 고친 칸은 남긴다', () => {
  const cur = version1({ 'customer.name': '한빛(사람이 고침)', 'customer.ceo': '이대표' })
  const plan = planRefill(cur, DOC2, CONTRACT.contractNo)
  assert.equal(plan.fieldValues['customer.name'].value, '한빛(사람이 고침)')
  assert.equal(plan.fieldValues['customer.name'].source, 'manual')
  assert.equal(plan.fieldValues['customer.ceo'].value, '이대표')
  assert.equal(plan.fieldValues['quote.total'].source, 'auto')
  assert.notEqual(plan.fieldValues['quote.total'].value, cur.fieldValues['quote.total'].value)
  assert.ok(!plan.changed.includes('customer.name'), '사람이 고친 칸을 바뀐다고 하지 않는다')
  assert.deepEqual(plan.kept, ['customer.name'], '견적 값이 바뀐 사람 칸은 남는다고 알린다')
})

test('★ 다시 채우기는 새 버전으로만 반영한다 — 지금 버전은 안 고친다', () => {
  const fn = SERVICE.slice(SERVICE.indexOf('export async function refillContractFromQuote'))
  assert.match(fn, /versionNo = cur\.versionNo \+ 1/)
  assert.match(fn, /kind: 'REFILLED'/)
  assert.match(fn, /cv\(tx\)\.create\(/)
  assert.ok(!/cv\(tx\)\.(update|updateMany|upsert|delete)/.test(fn), '버전 표를 고치는 자리가 있다')
  assert.match(fn, /where: \{ id, version \}/, 'version 이 어긋나면 CONFLICT')
  assert.match(fn, /plan\.changed\.length === 0/, '바뀐 칸이 없으면 버전을 안 만든다')
  assert.match(fn, /canContractFromQuote\(quote\.status\)/, '작성 중으로 돌아간 견적으로는 안 채운다')
})

test('다시 채우기는 기존 PATCH 창구 안의 동작이다 — 새 창구 없음', () => {
  const route = read('app/api/crm/contracts/[id]/route.ts')
  assert.match(route, /refill === true/)
  assert.match(route, /refillContractFromQuote\(db, session\.workspaceId/)
  assert.match(route, /withCrmApi\('MEMBER'/)
})

test('본문 조항은 다시 채우기에서 안 바뀐다', () => {
  const cur = version1()
  const plan = planRefill(cur, DOC2, CONTRACT.contractNo)
  assert.equal(plan.hash, contentHash(cur.body, plan.fieldValues))
})
