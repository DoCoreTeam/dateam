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

test('할인 탭은 미확정 제안값을 한 번에 확정하는 단추를 두고, 확인창을 거쳐 이 탭의 할인만 confirmed 로 바꾼다', () => {
  assert.match(tab, /PRICEBOOK\.confirmAllProposals\(pending\.length\)/)
  assert.match(tab, /mode === 'discounts' && pending\.length > 0/)
  assert.match(tab, /const confirmAll = async \(\) => \{\s*const ok = await ask\.confirm\(/)
  assert.match(tab, /!x\.rule\.confirmed && isMine\(x\.rule\) \? \{ \.\.\.x, rule: \{ \.\.\.x\.rule, confirmed: true \} \}/)
})

test('제품 목록은 미확정 할인 수를 서비스에서 받아 배지로 보인다', () => {
  const list = readFileSync(new URL('../../../app/(crm)/crm/products/PriceProductListView.tsx', import.meta.url), 'utf8')
  const svc = readFileSync(new URL('../services/pricebook.ts', import.meta.url), 'utf8')
  assert.match(list, /r\.unconfirmedDiscountCount > 0/)
  assert.match(list, /PRICEBOOK\.unconfirmedCount\(r\.unconfirmedDiscountCount\)/)
  assert.match(svc, /unconfirmedDiscountCount: unconfirmed\.get\(r\.id\) \?\? 0/)
  assert.match(svc, /kind: 'DISCOUNT', isEnabled: true/)
})
