/**
 * openapi.json 합치기, GET me, 승인 요청 (P0158 I08)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeSpecs } from './openapi.ts'
import { MOUNTED } from './generated/table.ts'
import { HUMAN_ONLY_ACTIONS, isHumanOnly, mayDecideApproval } from './dispatch-core.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (...p: string[]) => readFileSync(join(WEB, ...p), 'utf8')
const GENERATED = JSON.parse(read('lib', 'actions', 'generated', 'openapi.json'))

test('★ 손으로 쓴 경로는 설명과 응답 모양 그대로, x-cli x-scope 만 붙는다', () => {
  const registry = {
    openapi: '3.1.0', info: { title: 't', version: '1' },
    paths: { '/crm/deals': { get: { operationId: 'deals.list', summary: '딜 목록', responses: { 200: { description: '성공' } } } } },
  }
  const generated = {
    paths: {
      '/crm/deals': { get: { operationId: 'x', summary: 'x', 'x-cli': 'crm deal list', 'x-scope': 'read' }, post: { operationId: 'crm.deal.create', 'x-cli': 'crm deal create', 'x-scope': 'write' } },
      '/actions/a/b': { post: { 'x-cli': 'a b', 'x-scope': 'write' } },
    },
  }
  const out = mergeSpecs(registry, generated)
  assert.equal(out.paths['/crm/deals'].get.summary, '딜 목록')
  assert.equal(out.paths['/crm/deals'].get.operationId, 'deals.list')
  assert.deepEqual(out.paths['/crm/deals'].get.responses, { 200: { description: '성공' } })
  assert.equal(out.paths['/crm/deals'].get['x-cli'], 'crm deal list')
  assert.equal(out.paths['/crm/deals'].post['x-scope'], 'write')
  assert.equal(out.paths['/actions/a/b'].post['x-cli'], 'a b')
  assert.match(out.info['x-spec-hash'], /^[0-9a-f]{16}$/)
  assert.equal(registry.paths['/crm/deals'].get.summary, '딜 목록', '원본을 고친다')
})

test('★ 정의 표의 모든 줄이 생성 스펙에 x-cli 와 x-scope 와 함께 있다', () => {
  const missing: string[] = []
  for (const op of MOUNTED) {
    const p = op.mount.replace(/\{(\w+)\*\}/g, '{$1}')
    const o = GENERATED.paths?.[p]?.[op.method.toLowerCase()]
    if (!o || o['x-cli'] !== op.cli || o['x-scope'] !== op.scope) missing.push(`${op.method} ${p}`)
  }
  assert.deepEqual(missing, [])
})

test('openapi.json 창구가 생성물을 합쳐 내고, me 와 승인 조회가 범위와 무관하게 키를 확인한다', () => {
  const spec = read('app', 'api', 'public', 'v1', 'openapi.json', 'route.ts')
  assert.match(spec, /import generated from '@\/lib\/actions\/generated\/openapi\.json'/)
  // 봉투 없이 문서 자체를 준다, 코드 생성 도구가 최상위 openapi 를 읽는다 (P0166 I04)
  assert.match(spec, /const spec = mergeSpecs\(\{/)
  assert.match(spec, /NextResponse\.json\(spec,/)
  assert.doesNotMatch(spec, /\bok\(mergeSpecs/)
  const me = read('app', 'api', 'public', 'v1', 'me', 'route.ts')
  assert.match(me, /authenticatePublicApi\(request, \{ deferScope: true \}\)/)
  assert.doesNotMatch(me, /key_hash|rawKey/)
  const ap = read('app', 'api', 'public', 'v1', 'approvals', '[id]', 'route.ts')
  assert.match(ap, /\.eq\('user_id', auth\.ctx\.userId\)/, '남의 승인 요청을 키로 읽는다')
})

test('★ 승인: 키 주인이나 관리자만, 만료면 실행 안 함, PENDING 을 먼저 집고 나서 같은 처리 함수를 부른다', () => {
  const src = read('lib', 'actions', 'dispatch.ts')
  const fn = src.slice(src.indexOf('export async function decideApproval('))
  const at = (re: RegExp) => { const i = fn.search(re); assert.ok(i >= 0, String(re)); return i }
  const order = [
    at(/if \(!mayDecideApproval\(\{ viaKey, deciderId: decider\.userId, ownerId: row\.user_id, deciderRole: decider\.role \}\)\) \{\s*return \{ ok: false, code: 'forbidden' \}/),
    at(/update\(\{ status: 'EXPIRED' \}\)/),
    at(/\.eq\('id', id\)\.eq\('status', 'PENDING'\)\.gt\('expires_at', now\)/),
    at(/await runAsKeyOwner\(/),
    at(/status: failed \? 'FAILED' : 'APPROVED'/),
  ]
  assert.deepEqual([...order].sort((a, b) => a - b), order)
  const expired = fn.slice(order[1] - 200, order[1] + 120)
  assert.match(expired, /return \{ ok: false, code: 'expired' \}/)
  assert.ok(fn.indexOf("if (next === 'REJECTED') return") < order[3], '거절해도 실행한다')
})

test('승인 화면과 결정 액션이 사람을 확인한다', () => {
  const page = read('app', '(member)', 'approvals', '[id]', 'page.tsx')
  assert.match(page, /if \(!user\) redirect\(/)
  assert.match(page, /row\.user_id === user\.id \|\| profile\?\.role === 'admin'/)
  const act = read('app', '(member)', 'approvals', '[id]', 'actions.ts')
  assert.match(act, /^'use server'/)
  assert.match(act, /z\.string\(\)\.uuid\(\)/)
  assert.match(act, /auth\.getUser\(\)/)
  const panel = read('app', '(member)', 'approvals', '[id]', 'ApprovalPanel.tsx')
  assert.match(panel, /ask\.confirm\(/)
  assert.doesNotMatch(panel, /window\.confirm/)
})

test('개발자센터가 CLI 명령을 정의 생성물에서 그린다', () => {
  const page = read('app', 'develop', 'page.tsx')
  assert.match(page, /activeSection === 'cli' && <CliSection \/>/)
  const sec = read('app', 'develop', 'CliSection.tsx')
  assert.match(sec, /import\('@\/lib\/actions\/generated\/openapi\.json'\)/)
})

test('★ 승인 결정 판정: 키 문맥이면 주인도 관리자도 안 되고, 사람 세션이면 주인이나 관리자만 (P0162 I01)', () => {
  const base = { deciderId: 'u1', ownerId: 'u1', deciderRole: 'member' }
  assert.equal(mayDecideApproval({ ...base, viaKey: true }), false, '키가 자기 요청을 스스로 통과시킨다')
  assert.equal(mayDecideApproval({ ...base, viaKey: true, deciderRole: 'admin' }), false, '관리자 키가 승인을 통과시킨다')
  assert.equal(mayDecideApproval({ viaKey: true, deciderId: 'a1', ownerId: 'u1', deciderRole: 'admin' }), false)
  assert.equal(mayDecideApproval({ ...base, viaKey: false }), true)
  assert.equal(mayDecideApproval({ viaKey: false, deciderId: 'a1', ownerId: 'u1', deciderRole: 'admin' }), true)
  assert.equal(mayDecideApproval({ viaKey: false, deciderId: 'u2', ownerId: 'u1', deciderRole: 'member' }), false)
})

test('★ 승인 결정 동작은 사람 전용 목록에 있고, 그 이름이 정의 표에 실제로 있다', () => {
  assert.ok(HUMAN_ONLY_ACTIONS.has('meta.approval.decide'))
  assert.equal(isHumanOnly('meta.approval.decide'), true)
  assert.equal(isHumanOnly('crm.deal.create'), false)
  const names = new Set(MOUNTED.map((o) => o.name))
  for (const n of HUMAN_ONLY_ACTIONS) assert.ok(names.has(n), `${n} 이 정의 표에 없다, 이름이 갈려 막는 줄이 안 걸린다`)
})

test('★ decideApproval 이 키 소유자 문맥이면 아무것도 읽고 쓰기 전에 forbidden 을 돌려준다', () => {
  const src = read('lib', 'actions', 'dispatch.ts')
  assert.match(src, /import \{[^}]*\bcurrentActing\b[^}]*\} from '\.\/acting-session'/)
  const start = src.indexOf('export async function decideApproval(')
  assert.ok(start >= 0)
  const fn = src.slice(start)
  const guard = fn.search(/const viaKey = currentActing\(\) !== undefined\s*\n\s*if \(viaKey\) return \{ ok: false, code: 'forbidden' \}/)
  assert.ok(guard >= 0, '키 문맥 확인이 없다')
  const firstTouch = Math.min(...[fn.indexOf('createAdminClient('), fn.indexOf('.from(')].filter((i) => i >= 0))
  assert.ok(guard < firstTouch, '키 문맥 확인이 DB 를 건드린 뒤에 있다')
})

test('★ GET me 가 만료일과 이번 분 남은 한도를 알려 준다, 키 값과 해시는 안 싣는다 (P0162 I04)', () => {
  const me = read('app', 'api', 'public', 'v1', 'me', 'route.ts')
  const body = me.slice(me.indexOf('return ok({'), me.indexOf('}, { ctx, request })'))
  assert.match(body, /expiresAt: ctx\.expiresAt/)
  assert.match(body, /remainingThisMinute: remainingThisMinute\(ctx\)/)
  assert.doesNotMatch(body, /key_hash|keyHash|key_prefix|apiKey|rawKey|hash/, 'me 응답에 키 값이나 해시가 실린다')
  const auth = read('lib', 'publicApiAuth.ts')
  // 한도 헤더와 me 가 같은 셈을 쓴다, 셈이 두 벌이면 둘이 다른 수를 말한다
  assert.match(auth, /'X-RateLimit-Remaining': String\(remainingThisMinute\(ctx\)\)/)
  assert.match(auth, /export function remainingThisMinute\(ctx: ApiKeyContext\): number \{\n  return Math\.max\(0, ctx\.rateLimitPerMinute - ctx\.usage\.thisMinute\)/)
  const ctxAt = auth.indexOf('const ctx: ApiKeyContext = {')
  assert.match(auth.slice(ctxAt, auth.indexOf('}', ctxAt)), /expiresAt: \(key\.expires_at/)
})
