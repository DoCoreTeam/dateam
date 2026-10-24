/**
 * OpenAPI 문서 모양 (P0165 I04)
 *
 * 코드 생성 도구는 최상위 openapi 키와 응답 선언, 매개변수 형을 읽는다
 * 봉투를 씌우거나 숫자 칸을 문자열로 선언하면 생성된 클라이언트가 틀린 형을 갖는다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ERROR_RESPONSES, FILE_RESPONSES, mergeSpecs, paramSchema, standardResponses } from './openapi.ts'
import { ENDPOINTS } from '../api-docs/registry.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const REQUIRED = ['201', '202', '400', '401', '403', '404', '409', '429']

test('표준 응답 선언에 201 202 400 401 403 404 409 429 가 있다', () => {
  const keys = Object.keys(standardResponses({ method: 'POST', approval: true }))
  for (const code of REQUIRED) assert.ok(keys.includes(code), `${code} 빠짐`)
  assert.ok(keys.includes('200'))
})

test('읽기는 201 과 409 를 싣지 않고 오류 응답은 그대로 싣는다', () => {
  const keys = Object.keys(standardResponses({ method: 'GET' }))
  assert.deepEqual(keys.sort(), ['200', '400', '401', '403', '404', '429'])
  assert.equal(Object.keys(ERROR_RESPONSES).length, 6)
})

test('생성물의 동작마다 오류 응답이 실리고 문서 전체에 201 202 가 있다', () => {
  const spec = JSON.parse(readFileSync(join(WEB, 'lib/actions/generated/openapi.json'), 'utf8'))
  const seen = new Set<string>()
  let ops = 0
  for (const item of Object.values(spec.paths) as Record<string, { responses: Record<string, unknown> }>[]) {
    for (const op of Object.values(item)) {
      ops++
      const codes = Object.keys(op.responses ?? {})
      codes.forEach((c) => seen.add(c))
      for (const c of ['400', '401', '403', '404', '429']) assert.ok(codes.includes(c), `${c} 없는 동작`)
    }
  }
  assert.ok(ops > 0)
  for (const code of REQUIRED) assert.ok(seen.has(code), `${code} 가 문서 어디에도 없음`)
})

test('limit 같은 숫자 매개변수는 number 로 선언된다', () => {
  assert.deepEqual(paramSchema('number'), { type: 'number' })
  assert.deepEqual(paramSchema('integer'), { type: 'integer' })
  assert.deepEqual(paramSchema('string'), { type: 'string' })
  const limits = ENDPOINTS.flatMap((e) => e.query ?? []).filter((p) => p.name === 'limit')
  assert.ok(limits.length > 0, '문서 표에 limit 매개변수가 없음')
  for (const p of limits) assert.ok(['number', 'integer'].includes(paramSchema(p.type).type), `limit 형 ${p.type}`)
})

test('openapi.json 창구는 봉투 없이 문서를 주고 형과 응답을 공용 함수로 만든다', () => {
  const src = readFileSync(join(WEB, 'app/api/public/v1/openapi.json/route.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
  assert.ok(!/\bok\s*\(/.test(src), 'ok( 로 봉투를 씌움')
  assert.ok(/NextResponse\.json\(\s*spec\b/.test(src), '문서를 그대로 내보내지 않음')
  assert.ok(src.includes('responseHeaders('), 'CORS 와 한도 헤더가 빠짐')
  assert.ok(src.includes('paramSchema(p.type)'), '매개변수 형을 문서 표에서 읽지 않음')
  assert.ok(src.includes('standardResponses('), '응답 선언을 공용 함수로 만들지 않음')
  assert.ok(/^\s*const auth = await authenticatePublicApi\(request\)/m.test(src), '키 확인이 첫 줄이 아님')
})

test('합친 스펙의 operationId 는 겹치지 않는다 (옛 경로 등재 쪽에 .alias)', () => {
  const registry = { openapi: '3.1.0', info: {}, paths: {
    '/fx': { get: { operationId: 'gpu.fx.list' } },
    '/pricing/gpu/fx': { get: { operationId: 'gpu.fx.list' } },
  } }
  const generated = { paths: { '/pricing/gpu/fx': { get: { operationId: 'gpu.fx.list', 'x-cli': 'gpu fx' } } } }
  const merged = mergeSpecs(registry, generated) as { paths: Record<string, Record<string, { operationId: string }>> }
  const ids = Object.values(merged.paths).flatMap((item) => Object.values(item).map((op) => op.operationId))
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(merged.paths['/pricing/gpu/fx'].get.operationId, 'gpu.fx.list')
  assert.equal(merged.paths['/fx'].get.operationId, 'gpu.fx.list.alias')
  assert.equal(registry.paths['/fx'].get.operationId, 'gpu.fx.list')
})

test('견적서 내려받기의 200 은 JSON 이 아니라 PDF PNG 이진 파일로 선언된다', () => {
  const spec = JSON.parse(readFileSync(join(WEB, 'lib/actions/generated/openapi.json'), 'utf8'))
  const ok200 = spec.paths['/crm/quotes/{id}/export'].get.responses['200']
  assert.deepEqual(Object.keys(ok200.content ?? {}).sort(), ['application/pdf', 'image/png'])
  for (const c of Object.values(ok200.content) as { schema: unknown }[]) {
    assert.deepEqual(c.schema, { type: 'string', format: 'binary' })
  }
  assert.ok(!('application/json' in ok200.content))
  assert.ok(FILE_RESPONSES['crm.quote.export'])
  // 손으로 쓴 문서가 같은 경로를 JSON 꼴로 두어도 합친 스펙은 이진 선언을 싣는다
  const registry = { openapi: '3.1.0', info: {}, paths: { '/crm/quotes/{id}/export': { get: { operationId: 'crm.quotes.export', responses: { 200: { description: 'x' }, 404: { description: '없음' } } } } } }
  const merged = mergeSpecs(registry, spec) as { paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, unknown> }> }>> }
  const op = merged.paths['/crm/quotes/{id}/export'].get
  assert.deepEqual(Object.keys(op.responses['200'].content ?? {}).sort(), ['application/pdf', 'image/png'])
  assert.ok(op.responses['404'])
})
