/**
 * 공개 API(/api/public/v1) 처리기는 전부 키의 역할을 본다
 *
 * **왜**: 키가 있는지만 보고 역할을 안 본 창구가 열 곳이 넘었다(감사 2026-10-23).
 *   외부용 api_user 키 하나로 전역 마진을 바꾸고(settings PATCH) 공급사와 재고를 쓰고 전사 CRM 을 읽었다.
 *   모두 서비스롤로 돌아 RLS 도 없었다. 새 창구를 만들 때 게이트를 빼먹으면 여기서 실패한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const V1 = join(WEB, 'app', 'api', 'public', 'v1')

/** 역할을 보는 장치, 키 게이트 둘, 또는 자기 역할 판정을 하는 연결 부품 */
const GATES = [/requireAdminKey\(auth\.ctx, request\)/, /requireMemberKey\(auth\.ctx, request\)/, /withPublicCrm\w*\(/, /withPublicCi\w*\(/]

/** 역할을 안 봐도 되는 처리기 — 이유를 적는다 */
const OPEN_TO_ANY_KEY: Record<string, string> = {
  'openapi.json/route.ts GET': 'API 명세 문서, 자료가 없다',
  'me/route.ts GET': '키 주인 자기 자신의 역할과 범위만 돌려준다, DB 를 따로 안 읽는다 (P0158 I08)',
}

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.')) return []
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return routes(p)
    return name === 'route.ts' ? [p] : []
  })
}

test('★ 공개 v1 의 모든 처리기는 키 역할 게이트를 DB 보다 먼저 지난다', () => {
  const files = routes(V1)
  assert.ok(files.length >= 20, `공개 v1 창구를 ${files.length}개만 찾았다`)
  const missing: string[] = []
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const rel = relative(V1, file)
    const starts = [...src.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)]
    for (const [i, m] of starts.entries()) {
      const key = `${rel} ${m[1]}`
      if (key in OPEN_TO_ANY_KEY) continue
      const body = src.slice(m.index!, starts[i + 1]?.index ?? src.length)
      const gateAt = Math.min(...GATES.map((g) => body.search(g)).filter((n) => n >= 0))
      const dbAt = body.indexOf('createAdminClient()')
      if (!Number.isFinite(gateAt) || (dbAt >= 0 && dbAt < gateAt)) missing.push(key)
    }
  }
  assert.deepEqual(missing, [], `역할 게이트가 없거나 DB 보다 늦은 처리기 ${missing.length}개`)
})

test('★ 쓰기는 관리자 키만 (가격 공급사 재고 마진)', () => {
  for (const [rel, method] of [
    ['settings/route.ts', 'PATCH'],
    ['pool-stock/route.ts', 'POST'],
    ['suppliers/route.ts', 'POST'],
  ]) {
    const src = readFileSync(join(V1, rel), 'utf8')
    const start = src.indexOf(`export async function ${method}(`)
    assert.ok(start >= 0, rel)
    const next = src.indexOf('export async function', start + 10)
    const body = src.slice(start, next < 0 ? src.length : next)
    assert.match(body, /requireAdminKey\(auth\.ctx, request\)/, `${rel} ${method} 은 관리자 키만 받아야 한다`)
  }
})

test('임직원 키 게이트는 admin 과 member 만 통과시킨다', () => {
  const src = readFileSync(join(WEB, 'lib', 'publicApiAuth.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export function requireMemberKey'))
  assert.match(fn.slice(0, 300), /ctx\.role === 'admin' \|\| ctx\.role === 'member'/)
})
