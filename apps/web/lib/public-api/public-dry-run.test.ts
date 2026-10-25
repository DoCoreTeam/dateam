/**
 * 공개 라우트의 dry-run (P0170 I09, 지시서 문제 9)
 *
 * 제 route.ts 를 가진 공개 라우트는 dryRun 을 몰라 몸통 검사까지 가서 400 이었다(pool-stock create-v1 supplier create-v1)
 * 키 인증이 dry-run 을 받아 판정만 돌려준다. 실행으로 새면 dry-run 이 실제로 쓴다, 그래서 모든 갈래가 여기서 끝나야 한다
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const V1 = join(WEB, 'app/api/public/v1')
const auth = readFileSync(join(WEB, 'lib/publicApiAuth.ts'), 'utf8')

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === 'node_modules' || n.startsWith('.')) return []
    const p = join(dir, n)
    return statSync(p).isDirectory() ? routes(p) : n === 'route.ts' ? [p] : []
  })
}

test('키 인증의 dry-run 갈래는 범위 역할 판정 모두에서 돌아온다 (실행으로 새지 않는다)', () => {
  const at = auth.indexOf('isDryRun(request.nextUrl, request.headers)')
  assert.ok(at > 0, 'dry-run 갈래가 없다')
  const block = auth.slice(at, auth.indexOf('\n  }\n', at))
  assert.equal((block.match(/return /g) ?? []).length, 3, '범위 없음 역할 없음 통과, 세 갈래 모두 돌아와야 한다')
  assert.match(block, /decision: 'run'/)
  // 범위 판정 뒤, 한도 기록 앞
  assert.ok(at > auth.indexOf('decideKeyAccess({'))
  assert.ok(at < auth.indexOf("admin.rpc('record_api_key_hit'"))
})

test('쓰기 공개 라우트가 요구하는 역할을 키 인증에도 알린다 (dry-run 판정이 실제와 같게)', () => {
  const wrong: string[] = []
  for (const file of routes(V1)) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/export async function (POST|PATCH|PUT|DELETE)\b[\s\S]*?\n\}/g)) {
      const body = m[0]
      const call = /authenticatePublicApi\(request(?:, \{([^}]*)\})?\)/.exec(body)
      if (!call || /deferScope/.test(call[1] ?? '')) continue
      const declared = /role: '(\w+)'/.exec(call[1] ?? '')?.[1] ?? 'admin'
      const needs = /requireMemberKey\(/.test(body) ? 'member' : /requireAdminKey\(/.test(body) ? 'admin' : null
      if (needs && needs !== declared) wrong.push(`${relative(V1, file)} ${m[1]}: 라우트 ${needs} 인증 ${declared}`)
    }
  }
  assert.deepEqual(wrong, [])
})
