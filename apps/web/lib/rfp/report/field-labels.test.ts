import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FIELD_LABEL, fieldLabel, sectionLabel, orderFields, orderSections,
  SECTION_ORDER, UNLABELED_SUFFIX, fieldUnit,
} from './field-labels.ts'
import { EXTRACT_TASKS } from './tasks.ts'

test('★ 태스크가 내는 칸에 이름표가 전부 있다 — 없으면 화면이 영문 키를 그대로 찍는다', () => {
  const missing: string[] = []
  for (const task of EXTRACT_TASKS) {
    for (const f of task.fields) if (!FIELD_LABEL[f]) missing.push(`${task.id}.${f}`)
  }
  assert.deepEqual(missing, [], `이름표 없는 칸: ${missing.join(', ')}`)
})

test('모르는 칸은 감추지 않고 모른다고 밝힌다 — 감추면 값이 조용히 사라진다', () => {
  const label = fieldLabel('someNewFieldFromModel')
  assert.ok(label.includes('someNewFieldFromModel'))
  assert.ok(label.includes(UNLABELED_SUFFIX))
})

test('아는 칸은 한글로', () => {
  assert.equal(fieldLabel('totalAmount'), '사업 예산')
  assert.equal(fieldLabel('vatIncluded'), '부가세 포함')
  assert.equal(fieldLabel('currency'), '통화')
})

test('절 이름도 한글로', () => {
  assert.equal(sectionLabel('budget'), '예산')
  assert.equal(sectionLabel('evaluation'), '평가 기준')
})

test('절은 사업을 판단하는 순서로 — 개요 다음이 예산이다', () => {
  const ordered = orderSections(['evaluation', 'budget', 'overview', 'scope'])
  assert.deepEqual(ordered, ['overview', 'budget', 'scope', 'evaluation'])
  assert.equal(SECTION_ORDER[0], 'overview')
})

test('순서표에 없는 절은 뒤로 — 버리지 않는다', () => {
  const ordered = orderSections(['알수없는절', 'budget'])
  assert.deepEqual(ordered, ['budget', '알수없는절'])
})

test('칸도 정해진 순서로, 모르는 칸은 뒤로', () => {
  const ordered = orderFields(['vatIncluded', 'totalAmount', 'zzzUnknown'])
  assert.deepEqual(ordered, ['totalAmount', 'vatIncluded', 'zzzUnknown'])
})

test('숫자에 단위를 붙인다 — 「1.5」만 있으면 무슨 뜻인지 모른다', () => {
  assert.equal(fieldUnit('durationMonths'), '개월')
  assert.equal(fieldUnit('technicalWeight'), '점')
  // 값 안에 단위가 들어오는 칸은 여기 없다 — 두 번 붙는다
  assert.equal(fieldUnit('totalAmount'), '')
})
