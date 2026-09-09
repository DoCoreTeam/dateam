import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateCaseInput, provisionalTitle, PROVISIONAL_TITLE } from './cases.ts'

test('사업명 없이도 케이스를 만든다 — 문서에서 나오는 값이다', () => {
  const r = validateCaseInput({ docClass: 'public' })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.value.title, PROVISIONAL_TITLE)
})

test('등급은 여전히 필수 — 기본값을 주면 NDA 가 공개로 들어온다', () => {
  const r = validateCaseInput({ title: '어떤 사업' })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'missing_doc_class')
})

test('사람이 적은 이름은 그대로 쓴다', () => {
  const r = validateCaseInput({ title: '  차세대 시스템 구축  ', docClass: 'public' })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.value.title, '차세대 시스템 구축')
})

test('파일 이름에서 임시 사업명을 만든다', () => {
  assert.equal(provisionalTitle('차세대 통합정보시스템 구축 제안요청서.hwp'), '차세대 통합정보시스템 구축 제안요청서')
  assert.equal(provisionalTitle('[공고] 스마트도시 통합플랫폼.pdf'), '스마트도시 통합플랫폼')
  assert.equal(provisionalTitle('붙임1. 과업내용서.hwpx'), '과업내용서')
  assert.equal(provisionalTitle('데이터_플랫폼_구축.docx'), '데이터 플랫폼 구축')
})

test('건질 것이 없으면 자리표를 쓴다 — 빈 제목으로 저장하지 않는다', () => {
  assert.equal(provisionalTitle(''), PROVISIONAL_TITLE)
  assert.equal(provisionalTitle(null), PROVISIONAL_TITLE)
  assert.equal(provisionalTitle('.pdf'), PROVISIONAL_TITLE)
  assert.equal(provisionalTitle('붙임1.'), PROVISIONAL_TITLE)
})
