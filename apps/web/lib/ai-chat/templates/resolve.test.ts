import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveTemplate, getGenericTemplate } from './resolve.ts'

test('resolveTemplate: "요구사항 정의서로 만들어" → requirements', () => {
  const r = resolveTemplate('요구사항 정의서로 만들어')
  assert.equal(r?.template.id, 'requirements')
  assert.equal(r?.source, 'catalog')
})

test('resolveTemplate: "리스크 레지스터로 정리" → risk', () => {
  assert.equal(resolveTemplate('리스크 레지스터로 정리')?.template.id, 'risk')
})

test('resolveTemplate: "표로 비교해줘" → compare', () => {
  assert.equal(resolveTemplate('표로 비교해줘')?.template.id, 'compare')
})

test('resolveTemplate: "실행계획 세워줘" → plan', () => {
  assert.equal(resolveTemplate('실행계획 세워줘')?.template.id, 'plan')
})

test('resolveTemplate: 순수 변형 지시("좀더 각각 디테일을 살려서")는 null (M3 — 템플릿 선택 아님)', () => {
  assert.equal(resolveTemplate('좀더 각각 디테일을 살려서 진행해줘'), null)
})

test('resolveTemplate: 빈 지시는 null', () => {
  assert.equal(resolveTemplate(''), null)
  assert.equal(resolveTemplate('   '), null)
})

test('resolveTemplate: generic은 스코어링에서 제외 — "분석해줘"만으론 특정 템플릿 매칭 안 됨', () => {
  // "분석"은 generic 키워드지만 generic은 폴백 전용이라 resolve는 null 반환.
  assert.equal(resolveTemplate('분석해줘'), null)
})

test('resolveTemplate: 커스텀 이름 일치가 카탈로그보다 우선', () => {
  const custom = [{ id: 'c1', name: '내 요구사항 양식', fields: [], assembly: { mode: 'table' as const, itemNoun: '항목' } }]
  const r = resolveTemplate('내 요구사항 양식으로 해줘', custom)
  assert.equal(r?.source, 'custom')
  assert.equal(r?.template.id, 'c1')
})

test('getGenericTemplate: 범용 템플릿 반환', () => {
  assert.equal(getGenericTemplate().id, 'generic')
})
