import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeFormFactor, extractFormFactor } from './form-factor.ts'

test('normalizeFormFactor — 세대숫자 흡수(SXM4/SXM5/SXM6 → SXM)', () => {
  assert.equal(normalizeFormFactor('SXM4'), 'SXM')
  assert.equal(normalizeFormFactor('SXM5'), 'SXM')
  assert.equal(normalizeFormFactor('SXM6'), 'SXM')
  assert.equal(normalizeFormFactor('SXM'), 'SXM')
  assert.equal(normalizeFormFactor('sxm'), 'SXM')
})

test('normalizeFormFactor — PCIe 대소문자·하이픈 변형', () => {
  assert.equal(normalizeFormFactor('PCIe'), 'PCIe')
  assert.equal(normalizeFormFactor('pcie'), 'PCIe')
  assert.equal(normalizeFormFactor('PCIE'), 'PCIe')
  assert.equal(normalizeFormFactor('PCI-E'), 'PCIe')
  assert.equal(normalizeFormFactor('pci-e'), 'PCIe')
})

test('normalizeFormFactor — NVL 대소문자', () => {
  assert.equal(normalizeFormFactor('NVL'), 'NVL')
  assert.equal(normalizeFormFactor('nvl'), 'NVL')
})

test('normalizeFormFactor — 매칭 불가 입력은 null', () => {
  assert.equal(normalizeFormFactor('Ada'), null)
  assert.equal(normalizeFormFactor('6000'), null)
  assert.equal(normalizeFormFactor(null), null)
  assert.equal(normalizeFormFactor(''), null)
  assert.equal(normalizeFormFactor('   '), null)
})

test('extractFormFactor — 기본 4예시', () => {
  assert.deepEqual(extractFormFactor('A100 SXM'), { core: 'A100', formFactor: 'SXM' })
  assert.deepEqual(extractFormFactor('B200 SXM6'), { core: 'B200', formFactor: 'SXM' })
  assert.deepEqual(extractFormFactor('H100 NVL'), { core: 'H100', formFactor: 'NVL' })
  assert.deepEqual(extractFormFactor('L40S'), { core: 'L40S', formFactor: null })
})

test('extractFormFactor — H100 PCIe', () => {
  assert.deepEqual(extractFormFactor('H100 PCIe'), { core: 'H100', formFactor: 'PCIe' })
})

test('extractFormFactor — RTX 6000 Ada·RTX PRO 6000 오제거 0(폼팩터 아닌 접미 보존)', () => {
  assert.deepEqual(extractFormFactor('RTX 6000 Ada'), { core: 'RTX 6000 Ada', formFactor: null })
  assert.deepEqual(extractFormFactor('RTX PRO 6000'), { core: 'RTX PRO 6000', formFactor: null })
  assert.deepEqual(extractFormFactor('RTX 4500 Ada'), { core: 'RTX 4500 Ada', formFactor: null })
})

test('extractFormFactor — 대소문자·하이픈 변형(GB200 SXM6, H100 PCI-E)', () => {
  assert.deepEqual(extractFormFactor('GB200 SXM6'), { core: 'GB200', formFactor: 'SXM' })
  assert.deepEqual(extractFormFactor('H100 PCI-E'), { core: 'H100', formFactor: 'PCIe' })
  assert.deepEqual(extractFormFactor('a100 sxm4'), { core: 'a100', formFactor: 'SXM' })
})

test('extractFormFactor — 빈 입력·단일토큰', () => {
  assert.deepEqual(extractFormFactor(''), { core: '', formFactor: null })
  assert.deepEqual(extractFormFactor(null), { core: '', formFactor: null })
  assert.deepEqual(extractFormFactor('H100'), { core: 'H100', formFactor: null })
})
