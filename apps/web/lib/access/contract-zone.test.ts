/**
 * 접근권한의 「계약서」 자리 (P0184 I12d)
 *
 *   1 /crm/contracts 아래 주소는 crm:contracts 자리로 판정한다, 그 자리와 쓰기 내보내기가 부여 목록에 있다
 *   2 자리에 부여가 없으면 영업 CRM 판정이 그대로 내려온다 — 등재만으로는 아무에게도 안 바뀐다
 *   3 자리를 막으면 영업 CRM 이 열려 있어도 계약서만 닫힌다, 쓰기만 막으면 쓰기만 닫힌다
 *   4 화면 문과 창구가 이 자리로 묻는다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { decideAccess, type Grant, type Viewer } from './decide.ts'
import { grantableKeys, zoneKeyOf } from './surfaces.ts'
import { vetoesAction } from './actions.ts'

const WEB = join(import.meta.dirname, '..', '..')
const MEMBER: Viewer = { userId: 'u-1', isAdmin: false, orgIds: ['org-sales'] }
const grant = (surfaceKey: string, effect: Grant['effect']): Grant => ({ surfaceKey, subject: { kind: 'user', id: MEMBER.userId }, effect })

test('1 계약 주소는 crm:contracts 자리이고 부여 목록에 자리와 쓰기 내보내기가 있다', () => {
  assert.equal(zoneKeyOf('/crm/contracts'), 'crm:contracts')
  assert.equal(zoneKeyOf('/crm/contracts/ct1'), 'crm:contracts')
  const keys = grantableKeys()
  for (const k of ['crm:contracts', 'crm:contracts#write', 'crm:contracts#export']) assert.ok(keys.includes(k), `${k} 가 부여 목록에 없다`)
})

test('2 자리 부여가 없으면 영업 CRM 판정이 내려온다', () => {
  for (const grants of [[], [grant('crm', 'allow')], [grant('crm', 'deny')]]) {
    assert.equal(decideAccess('crm:contracts', MEMBER, grants).allowed, decideAccess('crm', MEMBER, grants).allowed)
  }
})

test('3 자리를 막으면 계약서만, 쓰기를 막으면 쓰기만 닫힌다', () => {
  const g = [grant('crm', 'allow'), grant('crm:contracts', 'deny')]
  assert.equal(decideAccess('crm', MEMBER, g).allowed, true)
  assert.equal(decideAccess('crm:contracts', MEMBER, g).allowed, false)
  const w = [grant('crm', 'allow'), grant('crm:contracts#write', 'deny')]
  assert.equal(decideAccess('crm:contracts', MEMBER, w).allowed, true)
  assert.equal(vetoesAction('write', ['crm:contracts', 'crm'], MEMBER, w), true)
  assert.equal(vetoesAction('write', ['crm'], MEMBER, w), false, '다른 CRM 창구의 쓰기는 그대로')
})

test('4 계약 화면 문과 창구 판정이 이 자리로 묻는다', () => {
  const layout = readFileSync(join(WEB, 'app/(crm)/crm/contracts/layout.tsx'), 'utf8')
  assert.match(layout, /if \(!\(await canOpen\(CONTRACT_HREF\)\)\) return <AccessDenied/)
  const handler = readFileSync(join(WEB, 'lib/crm/api/handler.ts'), 'utf8')
  assert.match(handler, /export const CONTRACT_HREF = '\/crm\/contracts'/)
  assert.match(handler, /if \(opts\.href && !\(await canOpen\(href\)\)\)/)
  assert.match(handler, /WRITE_ROLES\.has\(required\) && !opts\.read && !\(await canWrite\(href\)\)/)
  assert.match(readFileSync(join(WEB, 'app/api/crm/contracts/[id]/export/route.ts'), 'utf8'), /canExport\(CONTRACT_HREF\)/)
})
