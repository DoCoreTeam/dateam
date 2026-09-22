/**
 * 화면이 이상값을 숨기지 않는다 (실측 2026-09-20 ~ 09-22)
 *
 * 드롭다운은 맞는 항목이 없으면 첫 항목을 그린다. 그래서 `global-model` 이 저장돼 있던
 * 이틀 동안 설정 화면은 「자동」이라고 말했고, 기능은 죽어 있었다.
 * 「안 된다」보다 나쁜 것은 「되는 것처럼 보인다」다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { unknownChoiceValue } from './setting-value.ts'

const CHOICES = [{ value: 'auto' }, { value: 'gemini' }, { value: 'mock' }]

test('★ 목록 밖의 값이면 그 값을 돌려준다 — 이 사고를 낸 값으로 확인한다', () => {
  assert.equal(unknownChoiceValue('global-model', CHOICES), 'global-model')
})

test('목록 안의 값이면 아무 말도 안 한다', () => {
  assert.equal(unknownChoiceValue('gemini', CHOICES), null)
})

test('저장된 값이 없으면 이상할 것이 없다 — 기본값으로 도는 중이다', () => {
  assert.equal(unknownChoiceValue(null, CHOICES), null)
  assert.equal(unknownChoiceValue('', CHOICES), null)
})

test('선택지를 아직 못 받았으면 값이 있는 쪽을 믿지 않는다 — 로딩 중에 경고를 띄우면 안 된다', () => {
  // 선택지가 빈 동안에는 어떤 값이든 «목록 밖»이 되므로, 화면은 목록이 온 뒤에 판단해야 한다
  assert.equal(unknownChoiceValue('gemini', []), 'gemini')
})

test('★ 설정 화면이 이 판정을 실제로 쓴다 — 안 쓰면 화면은 계속 첫 항목을 그린다', () => {
  const src = readFileSync(
    new URL('../../../app/(crm)/crm/settings/SettingsCard.tsx', import.meta.url), 'utf-8')
  assert.match(src, /unknownChoiceValue\(/, '판정을 안 부른다')
  assert.match(src, /settingUnknownValue\(/, '이상값을 말해 주는 문장이 없다')
  assert.match(src, /settingUnknownOptionLabel\(/,
    '드롭다운에 그 값을 안 얹는다 — select 가 첫 항목을 그려 거짓말을 한다')
})
