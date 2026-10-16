import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeClauseHtml, normalizeClauses, contentHash, diffClauses, diffFields, wordDiff, stripTags,
  nextClauseId, ClauseInputError, type Clause,
} from './contract-body.ts'

test('★ 정리기가 스크립트, 이벤트 속성, javascript 주소를 지운다 (보안 S4)', () => {
  const dirty = '<p onclick="x()">가<script>alert(1)</script><a href="javascript:alert(1)">나</a><img src=x onerror=y></p>'
  const clean = sanitizeClauseHtml(dirty)
  assert.doesNotMatch(clean, /script|onclick|onerror|javascript|<img|<a /i)
  assert.match(clean, /가/)
  assert.match(clean, /나/)
})

test('표는 남는다 — 계약서에는 품목표가 있다', () => {
  const html = '<table><thead><tr><th>품목</th></tr></thead><tbody><tr><td colspan="2">H100</td></tr></tbody></table>'
  assert.equal(sanitizeClauseHtml(html), html)
})

test('정렬 말고 다른 style 은 지운다', () => {
  assert.equal(sanitizeClauseHtml('<p style="text-align:center;color:red">가</p>'), '<p style="text-align:center">가</p>')
})

test('조항 목록 모양이 틀리면 이유를 대며 거절한다', () => {
  assert.throws(() => normalizeClauses('x'), ClauseInputError)
  assert.throws(() => normalizeClauses([{ id: 'a b', title: '', html: '' }]), /id/)
  assert.throws(() => normalizeClauses([{ id: 'c1', html: '' }, { id: 'c1', html: '' }]), /겹칩니다/)
})

const A: Clause[] = [
  { id: 'c1', title: '제1조 (목적)', html: '<p>갑은 을에게 GPU 를 제공한다.</p>' },
  { id: 'c7', title: '제7조 (대금 지급)', html: '<p>대금은 매월 말일에 지급한다.</p>' },
]

test('★ 같은 내용은 같은 지문, 한 글자나 순서가 바뀌면 다른 지문', () => {
  const fv = { 'customer.name': { value: '한빛' } }
  const h = contentHash(A, fv)
  assert.equal(h, contentHash(structuredClone(A), { ...fv }))
  assert.notEqual(h, contentHash([A[1], A[0]], fv))
  assert.notEqual(h, contentHash([A[0], { ...A[1], html: '<p>대금은 매월 10일에 지급한다.</p>' }], fv))
  assert.notEqual(h, contentHash(A, { 'customer.name': { value: '한빛데이터' } }))
})

test('★ 비교가 더한 조항, 뺀 조항, 고친 조항과 그 낱말을 낸다', () => {
  const B: Clause[] = [
    A[0],
    { id: 'c7', title: '제7조 (대금 지급)', html: '<p>대금은 매월 10일에 지급한다.</p>' },
    { id: 'c8', title: '제7조의2 (지체상금)', html: '<p>지체상금을 지급한다.</p>', origin: 'ai' },
  ]
  const d = diffClauses(A, B)
  assert.deepEqual(d.map((x) => [x.id, x.kind]), [['c7', 'changed'], ['c8', 'added']])
  const seg = d[0].segments
  assert.ok(seg.some((s) => s.type === 'del' && s.text.includes('말일에')))
  assert.ok(seg.some((s) => s.type === 'ins' && s.text.includes('10일에')))
  assert.deepEqual(diffClauses(B, A).map((x) => [x.id, x.kind]), [['c7', 'changed'], ['c8', 'removed']])
  assert.deepEqual(diffClauses(A, A), [])
})

test('낱말 차이를 다시 이으면 양쪽 글이 그대로 나온다', () => {
  const a = '대금은 매월 말일에 지급한다'
  const b = '대금은 매월 10일에 현금으로 지급한다'
  const seg = wordDiff(a, b)
  assert.equal(seg.filter((s) => s.type !== 'ins').map((s) => s.text).join(''), a)
  assert.equal(seg.filter((s) => s.type !== 'del').map((s) => s.text).join(''), b)
})

test('칸 값 차이는 글 차이와 따로 나온다', () => {
  const d = diffFields(
    { 'contract.end': { value: '2027-03-31', source: 'auto' } },
    { 'contract.end': { value: '2027-04-30', source: 'manual' } },
  )
  assert.deepEqual(d, [{ key: 'contract.end', before: '2027-03-31', after: '2027-04-30', source: 'manual' }])
})

test('글자만 남기기와 새 조항 id', () => {
  assert.equal(stripTags('<p>가 &amp; 나</p><p>다</p>'), '가 & 나다')
  assert.equal(nextClauseId(A), 'c3')
})
