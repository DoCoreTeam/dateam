import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const dir = new URL('../../../app/(crm)/crm/products/[id]/', import.meta.url)
const tab = readFileSync(new URL('RulesTab.tsx', dir), 'utf8')
const modal = readFileSync(new URL('RuleAddModal.tsx', dir), 'utf8')

test('규칙 저장은 켬과 끔을 같은 자리 배열로 함께 보낸다 — 안 보내면 꺼 둔 규칙이 다시 켜진다', () => {
  assert.match(tab, /rules: rows\.map\(\(r\) => r\.rule\), enabled: rows\.map\(\(r\) => r\.enabled\)/)
})

test('지우기는 확인창을 거친다(브라우저 기본 대화상자 아님), 줄마다 고치기 켜고 끄기 복제가 있다', () => {
  assert.match(tab, /await ask\.confirm\(/)
  assert.doesNotMatch(tab, /window\.confirm|[^.]confirm\(/)
  for (const t of ['PRICEBOOK.ruleTurnOff', 'PRICEBOOK.ruleTurnOn', 'ACTION.edit', 'PRICEBOOK.duplicate', 'PRICEBOOK.confirmProposal']) assert.ok(tab.includes(t), t)
  assert.match(tab, /<ReorderList/)
})

test('할인 확정은 confirmed 를 참으로, 고치기는 그 값으로 채워 연다', () => {
  assert.match(tab, /\{ \.\.\.discount, confirmed: true \}/)
  assert.match(modal, /initial\?: PriceRule \| null/)
  assert.match(modal, /confirmed: init\.confirmed === true/)
})
