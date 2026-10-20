import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cleanRenames, orphanSections, HUMAN_OFF } from './pricebook.ts'

test('묶음 이름 바꾸기 입력 — 빈 것과 같은 이름은 버리고, 새 이름이 겹치면 거절', () => {
  assert.deepEqual(cleanRenames([{ from: '구축비', to: '구축비 (1회)' }, { from: 'A', to: 'A' }, { from: '', to: 'B' }]), [{ from: '구축비', to: '구축비 (1회)' }])
  assert.throws(() => cleanRenames([{ from: 'A', to: 'C' }, { from: 'B', to: 'C' }]))
  assert.deepEqual(cleanRenames(null), [])
})

test('품목이 남은 묶음은 못 지운다, 이름을 바꾼 묶음은 새 이름으로 센다', () => {
  assert.deepEqual(orphanSections(['라이선스', '구축비', null], ['라이선스'], []), ['구축비'])
  assert.deepEqual(orphanSections(['라이선스', '구축비'], ['라이선스', '구축비 (1회)'], [{ from: '구축비', to: '구축비 (1회)' }]), [])
})

test('이름 바꾸기가 품목, 비율 대상, 규모 조정 규칙을 같이 바꾼다 — 한 트랜잭션 안에서', () => {
  const src = readFileSync(new URL('./pricebook.ts', import.meta.url), 'utf8')
  const body = src.slice(src.indexOf('export async function updatePriceProduct'), src.indexOf('export async function deletePriceProduct'))
  assert.match(body, /withCrmTx/)
  assert.match(body, /data: \{ section: r\.to \}/)
  assert.match(body, /data: \{ ratioOfSection: r\.to \}/)
  assert.match(body, /kind: 'SCALE_CAP'/)
})

test('사람이 끈 규칙은 사유 「사람이 끔」으로 저장되고 창구가 켬과 끔을 받는다', () => {
  assert.equal(HUMAN_OFF, '사람이 끔')
  const src = readFileSync(new URL('./pricebook.ts', import.meta.url), 'utf8')
  assert.match(src, /isEnabled: reason === null && !off, disabledReason: reason \?\? \(off \? HUMAN_OFF : null\)/)
  const route = readFileSync(new URL('../../../app/api/crm/pricebook/products/[id]/rules/route.ts', import.meta.url), 'utf8')
  assert.match(route, /body\.enabled/)
})
