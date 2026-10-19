import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { blockedActionLink } from './blocked-action-link.ts'
import { CONTRACT_MSG } from '../../terms/contract-doc.ts'
import { crmSettingsHref, parseCrmSettingsTab, CRM_SETTINGS_CARDS } from '../domain/settings-tab.ts'

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

test('템플릿이 없다는 안내는 계약 탭으로 가는 단추를 단다', () => {
  for (const msg of [CONTRACT_MSG.noTemplate, CONTRACT_MSG.templateNotPublished]) {
    const link = blockedActionLink(msg)
    assert.equal(link?.href, '/crm/settings?tab=contract', msg)
    assert.ok(link?.label)
  }
})

test('갈 곳이 없는 안내에는 단추를 달지 않는다', () => {
  assert.equal(blockedActionLink(CONTRACT_MSG.notFound), null)
  assert.equal(blockedActionLink(null), null)
  assert.equal(blockedActionLink(''), null)
})

test('목적지 탭에 계약서 템플릿 카드가 실제로 있다', () => {
  const card = CRM_SETTINGS_CARDS.find((c) => c.component === 'ContractTemplatesCard')
  assert.equal(card?.tab, 'contract')
  assert.equal(crmSettingsHref('contract'), '/crm/settings?tab=contract')
})

test('주소의 탭 값은 목록에 있는 것만 받는다', () => {
  assert.equal(parseCrmSettingsTab('contract'), 'contract')
  assert.equal(parseCrmSettingsTab('../admin'), undefined)
  assert.equal(parseCrmSettingsTab('constructor'), undefined)
  assert.equal(parseCrmSettingsTab(undefined), undefined)
})

test('설정 화면이 주소의 탭을 열고, 견적 패널이 안내에 단추를 붙인다', () => {
  const page = read('../../../app/(crm)/crm/settings/page.tsx')
  assert.match(page, /defaultTab=\{parseCrmSettingsTab\(tab\)\}/)
  const panel = read('../../../components/ui/crm/QuotePanel.tsx')
  assert.match(panel, /helpHref=\{blockedActionLink\(actionError\)\?\.href\}/)
})
