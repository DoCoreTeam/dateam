/**
 * 계약서 AI 로 고치기 (P0132 I09)
 *
 * 세 약속을 본다
 *   1 지시하지 않은 조항은 글자 하나 안 바뀐다, 앞 글이 없거나 여러 곳이면 그 조각은 버린다
 *   2 칸 값(상호 대표자 주소 사업자번호)은 AI 에 글자로 안 나간다
 *   3 자동 반영 0, 사람이 받은 조각만 다음 버전이 되고 지시 문장이 버전 메모에 남는다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  applyPatchToHtml, applyPatches, judgePatches, parseContractEdit, touchesNumbers, PatchApplyError,
} from './contract-patch.ts'
import { fieldToken, mergeFieldValues } from './contract-fields.ts'
import type { Clause } from './contract-body.ts'
import { CrmError } from './errors.ts'
import { checkAcceptedPieces, cleanInstruction, clauseLines, promptInputOf } from '../services/contract-ai.ts'
import { CONTRACT_AI_REJECT, CONTRACT_FIELD_LABEL } from '../../terms/contract-doc.ts'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const tok = (key: string) => fieldToken(CONTRACT_FIELD_LABEL[key])

const BODY: Clause[] = [
  { id: 'c1', title: '제1조 (당사자)', html: `<p>${tok('supplier.name')}(이하 갑)와 ${tok('customer.name')}(이하 을)은 아래와 같이 계약한다.</p>` },
  { id: 'c2', title: '제2조 (대금)', html: `<p>계약 금액은 ${tok('quote.total')}으로 한다.</p><p>대금은 검수 후 30일 안에 지급한다.</p>` },
  { id: 'c3', title: '제3조 (해지)', html: '<p>갑과 을은 30일 전에 알리고 해지할 수 있다.</p><p style="text-align:center">갑과 을</p>' },
]

/* ── 1 조각 판정 ─────────────────────────────────── */

test('★ 지시하지 않은 조항은 글자 하나 안 바뀐다', () => {
  const out = applyPatches(BODY, [{ clause: 2, before: '검수 후 30일 안에', after: '검수 후 45일 안에' }])
  assert.equal(out[1].html, '<p>계약 금액은 ' + tok('quote.total') + '으로 한다.</p><p>대금은 검수 후 45일 안에 지급한다.</p>')
  assert.deepEqual(out[0], BODY[0])
  assert.deepEqual(out[2], BODY[2])
  assert.equal(out[1].origin, 'ai', '닿은 조항은 AI 가 쓴 글로 적힌다')
  assert.equal(BODY[1].html.includes('45일'), false, '원래 본문을 고치지 않는다')
})

test('★ 앞 글이 지금 조항에 없으면 그 조각은 버린다', () => {
  const [v] = judgePatches(BODY, [{ clause: 2, before: '검수 후 60일 안에', after: 'x', why: '' }])
  assert.equal(v.ok, false)
  assert.equal(v.reject, 'not_found')
})

test('★ 앞 글이 여러 곳이면 어디인지 모르므로 버린다', () => {
  const [v] = judgePatches(BODY, [{ clause: 3, before: '갑과 을', after: '양 당사자', why: '' }])
  assert.equal(v.reject, 'ambiguous')
})

test('태그 속성 안의 글은 글자 자리가 아니다', () => {
  assert.deepEqual(applyPatchToHtml('<p style="text-align:center">가운데</p>', { before: 'center', after: 'left' }), { reject: 'not_found' })
})

test('없는 조항, 여러 줄, 바뀌는 것 없음, 칸을 반만 건드림, 없는 칸 이름은 버린다', () => {
  const v = judgePatches(BODY, [
    { clause: 9, before: '계약', after: '약정', why: '' },
    { clause: 2, before: '30일 안에\n지급', after: 'x', why: '' },
    { clause: 3, before: '해지할 수 있다', after: '해지할 수 있다', why: '' },
    { clause: 1, before: '{{공급자', after: '{{고객', why: '' },
    { clause: 1, before: '아래와 같이', after: '{{없는칸}} 아래와 같이', why: '' },
  ])
  assert.deepEqual(v.map((x) => x.reject), ['no_clause', 'multiline', 'same', 'broken_field', 'unknown_field'])
  for (const x of v) assert.ok(CONTRACT_AI_REJECT[x.reject!], `${x.reject} 에 화면 말이 없다`)
})

test('칸 자리를 통째로 옮기는 조각은 받는다', () => {
  const r = applyPatchToHtml(BODY[0].html, { before: `${tok('customer.name')}(이하 을)`, after: `${tok('customer.name')}(이하 「고객」)` })
  assert.ok('html' in r && r.html.includes('(이하 「고객」)'))
})

test('바꾼 글도 정리기를 지난다 — 태그를 넣어도 글자가 된다', () => {
  const r = applyPatchToHtml(BODY[2].html, { before: '해지할 수 있다.', after: '해지할 수 있다.<script>alert(1)</script>' })
  assert.ok('html' in r)
  assert.equal(r.html.includes('<script>'), false)
})

test('★ 숫자 날짜 금액이 바뀐 조각은 표시한다', () => {
  assert.equal(touchesNumbers('검수 후 30일', '검수 후 45일'), true)
  assert.equal(touchesNumbers('대금은 지급한다', '대금은 치른다'), false)
  assert.equal(touchesNumbers(`금액은 ${tok('quote.total')}`, '금액은 별도로 정한다'), true, '금액 칸이 빠져도 표시')
  const [a, b] = judgePatches(BODY, [
    { clause: 2, before: '30일 안에', after: '45일 안에', why: '' },
    { clause: 3, before: '해지할 수 있다', after: '계약을 끝낼 수 있다', why: '' },
  ])
  assert.equal(a.numeric, true)
  assert.equal(b.numeric, false)
})

test('반영은 순서대로 대 보고, 앞 조각이 지운 글을 뒤 조각이 가리키면 통째로 거절한다', () => {
  assert.throws(
    () => applyPatches(BODY, [
      { clause: 2, before: '검수 후 30일 안에', after: '검수 후 45일 안에' },
      { clause: 2, before: '30일 안에', after: '60일 안에' },
    ]),
    (e) => e instanceof PatchApplyError && e.index === 1 && e.why === 'not_found',
  )
})

test('AI 답 모양 — 조각 수 상한과 JSON 앞뒤 군말', () => {
  const doc = parseContractEdit('여기 있습니다 {"edits":[{"clause":1,"before":"가","after":"나"}]} 끝')
  assert.equal(doc.edits[0].why, '')
  const many = JSON.stringify({ edits: Array.from({ length: 31 }, () => ({ clause: 1, before: '가', after: '나' })) })
  assert.throws(() => parseContractEdit(many))
  assert.throws(() => parseContractEdit('{"edits":[{"clause":0,"before":"가","after":"나"}]}'))
})

/* ── 2 무엇이 밖으로 나가나 ───────────────────────── */

test('★ 칸 값은 AI 에 글자로 나가지 않는다 — 칸 이름만 간다', () => {
  // 합성 견본 — 지어낸 값이다
  const secrets = {
    'customer.name': '주식회사 한빛테크', 'customer.ceo': '박대표', 'customer.bizNo': '220-81-12345',
    'customer.address': '서울시 강남구 테헤란로 1', 'supplier.name': '주식회사 에이엑스',
  }
  const values = mergeFieldValues(secrets, {})
  assert.equal(values['customer.name'].value, '주식회사 한빛테크', '견본이 칸 값으로 들어갔다')
  const input = promptInputOf(BODY, '대금 지급 기한을 45일로')
  for (const v of Object.values(secrets)) assert.equal(input.includes(v), false, `${v} 가 나간다`)
  assert.ok(input.includes(tok('customer.name')), '칸 이름은 간다')
  assert.ok(input.includes('대금 지급 기한을 45일로'))
})

test('★ AI 로 나가는 글은 본문과 지시만으로 만든다 — 칸 값과 견적 스냅샷을 안 넘긴다', () => {
  const src = read('lib/crm/services/contract-ai.ts')
  assert.ok(src.includes('promptInputOf(current.body, instruction)'))
  assert.equal(/promptInputOf\([^)]*(fieldValues|quoteSnapshot)/.test(src), false)
  assert.equal(/inputRef:[^\n]*(fieldValues|quoteSnapshot|instruction[,}])/.test(src), false, '원장에 지시 원문이나 칸 값을 안 남긴다')
  assert.ok(src.includes('runAi<ContractEditDoc>'), '예산 원장 가림이 있는 runAi 를 지난다')
  assert.ok(src.includes('parse: parseContractEdit'), '응답은 zod 로 본다')
})

test('본문은 줄 단위로 나간다 — 문단 사이가 붙지 않는다', () => {
  assert.equal(clauseLines(BODY[1].html), `계약 금액은 ${tok('quote.total')}으로 한다.\n대금은 검수 후 30일 안에 지급한다.`)
})

/* ── 3 자동 반영 0 ────────────────────────────────── */

test('★ 제안은 아무것도 저장하지 않는다', () => {
  const src = read('lib/crm/services/contract-ai.ts')
  const propose = src.slice(src.indexOf('export async function proposeContractEdit'), src.indexOf('/** 화면이 보낸 받은 조각'))
  assert.ok(propose.length > 100)
  assert.equal(/saveContractVersion|withCrmTx|\.create\(|\.update/.test(propose), false)
})

test('★ 반영은 받은 조각을 서버가 다시 대 보고 AI_EDIT 버전으로, 메모에 지시 문장을 남긴다', () => {
  const src = read('lib/crm/services/contract-ai.ts')
  const apply = src.slice(src.indexOf('export async function applyContractEdit'))
  assert.ok(apply.includes('applyPatches(current.body, pieces)'))
  assert.ok(apply.includes("{ body, note: instruction }, 'AI_EDIT')"))
  assert.ok(apply.includes("throw new CrmError('CONFLICT'"))
})

test('받은 조각 모양 — 빈 목록, 모양 틀림은 거절, 판정 결과는 서버가 다시 낸다', () => {
  const code = (c: string) => (e: unknown) => e instanceof CrmError && e.code === c
  assert.throws(() => checkAcceptedPieces([]), code('VALIDATION_FAILED'))
  assert.throws(() => checkAcceptedPieces([{ clause: '1', before: 'a', after: 'b' }]), code('VALIDATION_FAILED'))
  assert.deepEqual(checkAcceptedPieces([{ clause: 1, before: 'a', after: 'b', ok: true, numeric: false }]), [{ clause: 1, before: 'a', after: 'b' }])
  assert.throws(() => cleanInstruction('  '), code('VALIDATION_FAILED'))
  assert.throws(() => cleanInstruction('가'.repeat(1001)), code('VALIDATION_FAILED'))
})

test('★ AI 고치기 창구는 둘 다 withCrmApi MEMBER 를 지난다', () => {
  const src = read('app/api/crm/contracts/[id]/ai-edit/route.ts')
  const handlers = src.match(/export async function (GET|POST|PATCH|PUT|DELETE)/g) ?? []
  assert.equal(handlers.length, 2)
  assert.equal((src.match(/withCrmApi\('MEMBER'/g) ?? []).length, 2)
})
