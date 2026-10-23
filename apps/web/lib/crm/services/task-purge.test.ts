/**
 * 휴지통의 할 일을 영구 삭제할 수 있다
 *
 * **왜** (실측 2026-10-23)
 *
 *   `DELETE /api/crm/tasks/[id]?mode=purge` 가 휴지통에 있는 할 일에 404 를 냈다.
 *   deleteTask 가 `where: { id }` 로만 찾아서 워크스페이스 가드가 deletedAt: null 을 붙였고,
 *   휴지통의 행은 그 조건에 안 걸려 NOT_FOUND 가 났다. 회사와 딜은 삭제 범위를 직접 적어 통과했다.
 *
 * DB 없이 돌리려고 실제 가드(injectWorkspaceFilter)를 지난 조건을 가짜 행 두 줄에 대 본다.
 * deleteTask 가 그 조건을 찾기와 지우기 양쪽에 쓰는지는 소스로 본다(주석은 지우고 센다).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { taskDeleteWhere } from './task.ts'
import { injectWorkspaceFilter } from '../db/workspace-guard.ts'

const WS = 'ws-1'
const ROOT = join(import.meta.dirname, '..', '..', '..')

type Row = { id: string; workspaceId: string; deletedAt: Date | null }

const TRASHED: Row = { id: 't-trash', workspaceId: WS, deletedAt: new Date('2026-10-20T00:00:00Z') }
const LIVE: Row = { id: 't-live', workspaceId: WS, deletedAt: null }
const OTHER_WS: Row = { id: 't-trash', workspaceId: 'ws-2', deletedAt: new Date('2026-10-20T00:00:00Z') }

/** 가드를 지난 where 가 행에 걸리는가. 여기서 쓰는 꼴(값 일치, null, { not: null })만 안다 */
function matches(where: Record<string, unknown>, row: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = (row as Record<string, unknown>)[key]
    if (cond === null) return value === null
    if (cond && typeof cond === 'object' && 'not' in cond) {
      const not = (cond as { not: unknown }).not
      if (not === null) return value !== null
      throw new Error(`이 시험이 모르는 조건: ${key}`)
    }
    if (cond && typeof cond === 'object') throw new Error(`이 시험이 모르는 조건: ${key}`)
    return value === cond
  })
}

function guarded(id: string, mode: 'trash' | 'purge', op: 'findFirst' | 'deleteMany'): Record<string, unknown> {
  const out = injectWorkspaceFilter({ where: taskDeleteWhere(id, mode) }, WS, op, 'CrmTask') as {
    where: Record<string, unknown>
  }
  return out.where
}

function code(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`)
  assert.ok(start >= 0, `${name} 이 없다`)
  const next = src.indexOf('\nexport ', start + 1)
  return src.slice(start, next < 0 ? undefined : next)
}

test('휴지통의 할 일은 영구 삭제 대상으로 찾히고 지워진다', () => {
  assert.equal(matches(guarded(TRASHED.id, 'purge', 'findFirst'), TRASHED), true, '찾기에서 휴지통 행이 빠진다')
  assert.equal(matches(guarded(TRASHED.id, 'purge', 'deleteMany'), TRASHED), true, '지우기에서 휴지통 행이 빠진다')
})

test('살아 있는 할 일은 영구 삭제로 바로 지우지 못한다', () => {
  assert.equal(matches(guarded(LIVE.id, 'purge', 'findFirst'), LIVE), false, '살아 있는 행이 영구 삭제 대상으로 찾힌다')
  assert.equal(matches(guarded(LIVE.id, 'purge', 'deleteMany'), LIVE), false, '살아 있는 행이 영구 삭제로 지워진다')
})

test('휴지통 보내기는 살아 있는 할 일만 노린다', () => {
  assert.equal(matches(guarded(LIVE.id, 'trash', 'findFirst'), LIVE), true)
  assert.equal(matches(guarded(TRASHED.id, 'trash', 'findFirst'), TRASHED), false, '이미 휴지통인 행을 또 보낸다')
})

test('다른 워크스페이스의 휴지통 행은 영구 삭제 대상이 아니다', () => {
  assert.equal(matches(guarded(OTHER_WS.id, 'purge', 'findFirst'), OTHER_WS), false)
  assert.equal(matches(guarded(OTHER_WS.id, 'purge', 'deleteMany'), OTHER_WS), false)
})

test('deleteTask 는 같은 조건으로 찾고 지운다', () => {
  const body = fnBody(code('lib/crm/services/task.ts'), 'deleteTask')
  assert.match(body, /crmTask\.findFirst\(\{\s*where:\s*taskDeleteWhere\(id, plan\.mode\)/, '찾기가 삭제 조건을 안 쓴다')
  assert.match(body, /crmTask\.deleteMany\(\{\s*where:\s*taskDeleteWhere\(id, plan\.mode\)/, '지우기가 삭제 조건을 안 쓴다')
  assert.ok(body.includes("throw new CrmError('NOT_FOUND'"), '못 찾으면 거절해야 한다')
})

test('할 일 삭제 창구의 권한 경로는 회사와 딜과 같다', () => {
  const task = fnBody(code('app/api/crm/tasks/[id]/route.ts'), 'DELETE')
  assert.match(task, /withCrmApi\('MEMBER'/, '할 일 삭제가 MEMBER 권한을 안 거친다')
  assert.match(task, /deleteTask\(session\.workspaceId, session\.memberId,/, '세션의 워크스페이스와 사람으로 지워야 한다')
  for (const path of ['app/api/crm/companies/[id]/route.ts', 'app/api/crm/deals/[id]/route.ts']) {
    assert.match(fnBody(code(path), 'DELETE'), /withCrmApi\('MEMBER'/, `${path} 의 기준이 바뀌었다`)
  }
})
