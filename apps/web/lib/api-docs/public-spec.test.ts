// 서버 명세와 CLI 에 박은 명세가 한 함수에서 나온다 (P0173)
// CLI 가 정의 표 생성물만 박아 등재 표에만 본문이 있는 공개 쓰기 넷이 본문 없이 나갔다
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { publicSpec } from './public-spec.ts'
import { ENDPOINTS } from './registry.ts'

const ROOT = process.cwd()
const generated = JSON.parse(readFileSync(join(ROOT, 'lib/actions/generated/openapi.json'), 'utf8'))
const embedded = JSON.parse(readFileSync(join(ROOT, '../../packages/teamda-cli/src/generated/spec.json'), 'utf8'))

test('★ 등재 표에 본문이 있는 쓰기는 합친 명세에도 본문이 있다', () => {
  const spec = publicSpec('/api/public/v1', generated)
  const missing = ENDPOINTS
    .filter((e) => e.body?.length && e.method !== 'GET')
    .filter((e) => !spec.paths[e.path]?.[e.method.toLowerCase()]?.requestBody)
    .map((e) => `${e.method} ${e.path}`)
  assert.deepEqual(missing, [])
})

test('★ CLI 에 박은 명세가 서버가 주는 명세와 같다 (cli:gen 뒤 teamda-cli embed-spec)', () => {
  const spec = JSON.parse(JSON.stringify(publicSpec('/api/public/v1', generated)))
  const written = JSON.parse(readFileSync(join(ROOT, 'lib/actions/generated/openapi.public.json'), 'utf8'))
  assert.deepEqual(written, spec, 'openapi.public.json 이 낡음, scripts/cli/gen.mjs 를 다시 돌림')
  assert.deepEqual(embedded, spec, 'CLI 내장 명세가 낡음, packages/teamda-cli 에서 bun scripts/embed-spec.ts')
})
