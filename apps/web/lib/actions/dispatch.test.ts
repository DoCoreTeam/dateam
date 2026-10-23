/**
 * 공개 API 관문 (P0158 I07)
 *
 * 판정은 dispatch-core 를 그대로 부르고, DB 를 쓰는 순서는 dispatch.ts 소스를 읽어 본다
 * (마이그레이션 318 표가 있는 시험 DB 가 없어 멱등 감사 승인 표에 실제로 쓰는 것은 여기서 못 본다)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  actionArgs, decideAccess, internalPath, isDryRun, matchMount, publicPathOf, requestHash, WRITE_LIMIT_PER_MINUTE,
} from './dispatch-core.ts'
import { MOUNTED } from './generated/table.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC = readFileSync(join(WEB, 'lib', 'actions', 'dispatch.ts'), 'utf8')

test('정의 하나가 내부 경로와 서버 액션 경로로 불린다', () => {
  const route = MOUNTED.find((o) => o.kind === 'route' && o.params.includes('id'))!
  const sample = route.mount.replace(/\{(\w+)\}/g, 'abc')
  const m = matchMount(MOUNTED, route.method, sample)
  assert.ok(m)
  assert.equal(m.op.mount, route.mount)
  assert.equal(internalPath(m.op.internal, m.params), route.internal.replace(/\{(\w+)\}/g, 'abc'))
  const action = MOUNTED.find((o) => o.kind === 'action')!
  assert.ok(action.mount.startsWith('/actions/'))
  assert.equal(matchMount(MOUNTED, 'POST', action.mount)?.op.name, action.name)
  assert.equal(matchMount(MOUNTED, 'GET', '/no/such/path'), null)
})

test('★ 표의 모든 줄이 자기 경로로 자기 자신에게 닿는다 (가로채는 줄 없음)', () => {
  const lost: string[] = []
  for (const op of MOUNTED) {
    const m = matchMount(MOUNTED, op.method, op.mount.replace(/\{(\w+)\}/g, 'x-1'))
    if (!m || m.op.name !== op.name) lost.push(`${op.method} ${op.mount} -> ${m?.op.name ?? 'none'}`)
  }
  assert.ok(MOUNTED.length > 700, `표가 ${MOUNTED.length}줄뿐이다`)
  assert.deepEqual(lost, [])
})

test('글자 그대로인 칸이 매개변수 칸을 이긴다', () => {
  const ops = [
    { name: 'a', scope: 'read', kind: 'route', method: 'GET', mount: '/x/{id}', internal: '/api/x/{id}', params: ['id'], exported: 'GET', module: 0 },
    { name: 'b', scope: 'read', kind: 'route', method: 'GET', mount: '/x/new', internal: '/api/x/new', params: [], exported: 'GET', module: 0 },
  ] as const
  assert.equal(matchMount(ops, 'GET', '/x/new')?.op.name, 'b')
  assert.deepEqual(matchMount(ops, 'GET', '/x/7')?.params, { id: '7' })
})

test('★ 범위 판정: 있으면 실행, 승인 범위가 없으면 202 승인, read write 가 없으면 403', () => {
  assert.deepEqual(decideAccess('read', ['read'], 'member'), { kind: 'run' })
  assert.deepEqual(decideAccess('write', ['read'], 'member'), { kind: 'forbidden', requiredScope: 'write' })
  assert.deepEqual(decideAccess('read', ['write'], 'member'), { kind: 'forbidden', requiredScope: 'read' })
  for (const s of ['approve', 'send', 'delete'] as const) {
    assert.deepEqual(decideAccess(s, ['read', 'write'], 'member'), { kind: 'approval', requiredScope: s })
    assert.deepEqual(decideAccess(s, [s], 'member'), { kind: 'run' })
  }
  assert.deepEqual(decideAccess('admin', ['read'], 'admin'), { kind: 'approval', requiredScope: 'admin' })
  assert.deepEqual(decideAccess('admin', ['read'], 'member'), { kind: 'forbidden', requiredScope: 'admin' }, '계정이 못 가지는 범위는 승인으로도 안 열린다')
  assert.deepEqual(decideAccess('delete', ['read', 'write'], 'api_user'), { kind: 'forbidden', requiredScope: 'delete' })
})

test('서버 액션 인자: 배열은 펼치고 객체는 매개변수 순서로, input 하나면 몸통 전체', () => {
  assert.deepEqual(actionArgs(['a', 'b'], [1, 2]), [1, 2])
  assert.deepEqual(actionArgs(['a', 'b'], { b: 2, a: 1 }), [1, 2])
  assert.deepEqual(actionArgs(['input'], { name: 'x' }), [{ name: 'x' }])
  assert.deepEqual(actionArgs(['input'], { input: { name: 'x' } }), [{ name: 'x' }])
  assert.deepEqual(actionArgs(['a'], undefined), [])
})

test('멱등 지문은 메서드 경로 몸통이 같아야 같다, dryRun 판정과 접두사 떼기', () => {
  assert.equal(requestHash('post', '/a', '{}'), requestHash('POST', '/a', '{}'))
  assert.notEqual(requestHash('POST', '/a', '{}'), requestHash('POST', '/a', '{"x":1}'))
  assert.equal(isDryRun(new URL('http://h/a?dryRun=1'), new Headers()), true)
  assert.equal(isDryRun(new URL('http://h/a'), new Headers({ 'x-dry-run': '1' })), true)
  assert.equal(isDryRun(new URL('http://h/a'), new Headers()), false)
  assert.equal(publicPathOf('/api/public/v1/crm/deals'), '/crm/deals')
})

function pos(re: RegExp): number {
  const i = SRC.search(re)
  assert.ok(i >= 0, `dispatch.ts 에 ${re} 가 없다`)
  return i
}

test('★ 관문 순서: 키 확인 → 범위 → 쓰기 한도 → dryRun → 승인 → 멱등 재생 → 실행 → 멱등 저장', () => {
  const order = [
    pos(/authenticatePublicApi\(request, \{ deferScope: true \}\)/),
    pos(/decideAccess\(op\.scope, ctx\.scopes, ctx\.role\)/),
    pos(/rpc\('record_api_key_write_hit'/),
    pos(/isDryRun\(url, request\.headers\)/),
    pos(/from\('api_approval_requests'\)\.insert/),
    pos(/from\('api_idempotency'\)\.select/),
    pos(/await runAsKeyOwner\(/),
    pos(/from\('api_idempotency'\)\.insert/),
  ]
  assert.deepEqual([...order].sort((a, b) => a - b), order)
  assert.equal(WRITE_LIMIT_PER_MINUTE, 20)
  const dry = SRC.slice(pos(/isDryRun\(url, request\.headers\)/), pos(/from\('api_approval_requests'\)\.insert/))
  assert.doesNotMatch(dry, /runAsKeyOwner|invoke\(/, 'dryRun 이 처리 함수를 부른다')
  assert.match(SRC, /'Idempotent-Replay': 'true'/)
  assert.match(SRC, /status: 'PENDING', approvalId: data\.id/)
})

test('★ 모든 쓰기 갈래가 감사 기록을 남기고, 기록에 키 에이전트 요청id ip 가 실린다', () => {
  const auditFn = SRC.slice(pos(/async function audit\(/), pos(/function forwardHeaders/))
  for (const col of ['key_id', 'agent', 'request_id', 'ip', 'action_name', 'status']) assert.match(auditFn, new RegExp(`${col}:`))
  const main = SRC.slice(pos(/export async function dispatchPublicApi/))
  const audits = main.match(/await audit\(/g)?.length ?? 0
  assert.ok(audits >= 5, `감사 기록 자리가 ${audits}곳뿐이다 (403 429 dryRun 202 실행)`)
  assert.match(SRC, /DROP_HEADERS = new Set\(\['x-api-key', 'authorization', 'cookie'/, '키와 쿠키를 처리 함수로 넘긴다')
})

const OVERLAP = [
  ['ci/channels', ['POST']], ['crm/tasks', ['POST']], ['crm/quotes', ['POST']], ['crm/deals', ['POST']],
  ['crm/people', ['POST']], ['crm/meetings', ['POST']], ['crm/companies', ['POST']],
  ['crm/companies/[id]', ['PATCH', 'DELETE']], ['crm/deals/[id]', ['PATCH', 'DELETE']], ['crm/people/[id]', ['PATCH', 'DELETE']],
] as const

test('★ 관문 입구가 있고, 겹치는 공개 라우트가 빠진 메서드를 관문으로 넘긴다', () => {
  const entry = join(WEB, 'app', 'api', 'public', 'v1', '[...path]', 'route.ts')
  assert.ok(existsSync(entry))
  const e = readFileSync(entry, 'utf8')
  assert.match(e, /const enter = \(request: NextRequest\) => dispatchPublicApi\(request\)/)
  for (const m of ['GET', 'POST', 'PATCH', 'DELETE']) assert.match(e, new RegExp(`export const ${m} = enter`))
  for (const [dir, methods] of OVERLAP) {
    const s = readFileSync(join(WEB, 'app', 'api', 'public', 'v1', dir, 'route.ts'), 'utf8')
    for (const m of methods) assert.match(s, new RegExp(`export const ${m} = dispatchPublicApi`), `${dir} ${m}`)
  }
})
