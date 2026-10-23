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
  assert.match(spec, /return ok\(mergeSpecs\(\{/)
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
    at(/row\.user_id !== decider\.userId && decider\.role !== 'admin'\) return \{ ok: false, code: 'forbidden' \}/),
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
