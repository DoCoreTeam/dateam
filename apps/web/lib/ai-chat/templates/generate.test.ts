import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTemplateSpec, buildTemplateGenPrompt } from './generate.ts'

test('parseTemplateSpec: 정상 JSON → 검증된 스펙', () => {
  const raw = JSON.stringify({
    name: '테스트 양식',
    description: '설명',
    fields: [
      { key: 'summary', label: '요약', description: '핵심', required: true },
      { key: 'detail', label: '상세', description: '자세히', required: false },
    ],
    assembly: { mode: 'table', itemNoun: '항목' },
  })
  const spec = parseTemplateSpec(raw)
  assert.equal(spec?.name, '테스트 양식')
  assert.equal(spec?.fields.length, 2)
  assert.equal(spec?.fields[1].required, false)
  assert.equal(spec?.assembly.mode, 'table')
})

test('parseTemplateSpec: 코드펜스 감싼 JSON도 파싱', () => {
  const raw = '```json\n{"name":"x","fields":[{"key":"a","label":"A"}],"assembly":{"mode":"sections","itemNoun":"항목"}}\n```'
  assert.equal(parseTemplateSpec(raw)?.name, 'x')
})

test('parseTemplateSpec: 프로토타입 오염 키 거부', () => {
  const raw = JSON.stringify({
    name: '악성',
    fields: [
      { key: '__proto__', label: '나쁨' },
      { key: 'constructor', label: '나쁨' },
      { key: 'good', label: '좋음' },
    ],
    assembly: { mode: 'sections', itemNoun: '항목' },
  })
  const spec = parseTemplateSpec(raw)
  assert.equal(spec?.fields.length, 1)
  assert.equal(spec?.fields[0].key, 'good')
})

test('parseTemplateSpec: 비영문/대문자 key 거부', () => {
  const raw = JSON.stringify({
    name: 'x',
    fields: [{ key: '요약', label: 'A' }, { key: 'Bad', label: 'B' }, { key: 'ok_1', label: 'C' }],
    assembly: { mode: 'sections', itemNoun: '항목' },
  })
  const spec = parseTemplateSpec(raw)
  assert.equal(spec?.fields.length, 1)
  assert.equal(spec?.fields[0].key, 'ok_1')
})

test('parseTemplateSpec: 깨진 JSON → null', () => {
  assert.equal(parseTemplateSpec('not json'), null)
})

test('parseTemplateSpec: 필드 0개 → null', () => {
  assert.equal(parseTemplateSpec(JSON.stringify({ name: 'x', fields: [], assembly: {} })), null)
})

test('parseTemplateSpec: name 없으면 null', () => {
  assert.equal(parseTemplateSpec(JSON.stringify({ fields: [{ key: 'a', label: 'A' }] })), null)
})

test('parseTemplateSpec: mode 미지정/이상값 → sections 폴백', () => {
  const spec = parseTemplateSpec(JSON.stringify({ name: 'x', fields: [{ key: 'a', label: 'A' }], assembly: { mode: 'weird', itemNoun: '건' } }))
  assert.equal(spec?.assembly.mode, 'sections')
  assert.equal(spec?.assembly.itemNoun, '건')
})

test('parseTemplateSpec: MAX_FIELDS(12) 초과 시 12개로 캡', () => {
  const fields = Array.from({ length: 20 }, (_, i) => ({ key: `f${i}`, label: `L${i}` }))
  const spec = parseTemplateSpec(JSON.stringify({ name: 'x', fields, assembly: { mode: 'sections', itemNoun: '항목' } }))
  assert.equal(spec?.fields.length, 12)
})

test('parseTemplateSpec: 중복 key는 첫 것만(dedup)', () => {
  const raw = JSON.stringify({
    name: 'x',
    fields: [{ key: 'dup', label: '첫번째' }, { key: 'dup', label: '두번째' }, { key: 'other', label: 'O' }],
    assembly: { mode: 'sections', itemNoun: '항목' },
  })
  const spec = parseTemplateSpec(raw)
  assert.equal(spec?.fields.length, 2)
  assert.equal(spec?.fields[0].label, '첫번째')
})

test('parseTemplateSpec: null/boolean 리터럴 JSON → null(비객체 거부)', () => {
  assert.equal(parseTemplateSpec('null'), null)
  assert.equal(parseTemplateSpec('true'), null)
  assert.equal(parseTemplateSpec('42'), null)
})

test('buildTemplateGenPrompt: 지시를 포함', () => {
  assert.ok(buildTemplateGenPrompt('회의록으로').includes('회의록으로'))
})
