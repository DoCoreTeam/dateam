/**
 * 명세에 명령별 입력이 실린다 (P0170 I01, 지시서 문제 7)
 *
 * 예전 명세는 이름 메서드 경로 범위만 실어 AI 가 조건 이름을 400 메시지로 짐작했다
 * 생성기(scripts/cli/extract-inputs.mjs)가 처리 함수에서 읽은 조건과 본문 칸을 여기서 지킨다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fieldSchema } from './openapi.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

function byCli(): Map<string, Json> {
  const spec = JSON.parse(readFileSync(join(WEB, 'lib/actions/generated/openapi.json'), 'utf8'))
  const out = new Map<string, Json>()
  for (const item of Object.values(spec.paths) as Json[]) {
    for (const op of Object.values(item) as Json[]) if (op['x-cli']) out.set(op['x-cli'], op)
  }
  return out
}

const query = (op: Json) => Object.fromEntries((op.parameters ?? []).filter((p: Json) => p.in === 'query').map((p: Json) => [p.name, p]))
const bodyOf = (op: Json) => op.requestBody?.content?.['application/json']?.schema ?? {}

test('일정 월별 조회는 year month 를 정수 필수로 싣는다', () => {
  const q = query(byCli().get('work calendar month'))
  assert.equal(q.year?.required, true)
  assert.equal(q.month?.schema.type, 'integer')
})

test('첨부 목록은 targetId 를 필수로, 대상 칸 이름은 target 으로 싣는다', () => {
  const q = query(byCli().get('crm attachment list'))
  assert.equal(q.targetId?.required, true)
  assert.ok(q.target, 'target 조건이 없다')
  assert.equal(q.targetType, undefined, '없는 이름 targetType 이 실렸다')
})

test('딜 목록은 q scope limit 을 싣고 조건 목록이 닫혀 있다', () => {
  const op = byCli().get('crm deal list')
  const q = query(op)
  for (const n of ['q', 'scope', 'limit']) assert.ok(q[n], `${n} 없음`)
  assert.equal(q.limit.schema.type, 'integer')
  assert.equal(op['x-query-complete'], true)
})

test('견적 수정 본문은 version 을 숫자 필수로 싣고 다른 칸을 받지 않는다', () => {
  const b = bodyOf(byCli().get('crm quote update'))
  assert.equal(b.properties?.version?.type, 'number')
  assert.ok(b.required?.includes('version'))
  assert.equal(b.additionalProperties, false)
})

test('일부만 아는 본문은 properties 대신 x-known-properties 에 싣는다 (옛 CLI 가 모르는 이름을 막지 않게)', () => {
  for (const op of byCli().values()) {
    const b = bodyOf(op)
    if (b['x-known-properties']) assert.equal(b.properties, undefined, op['x-cli'])
    if (b.properties && op['x-kind'] === 'route') assert.equal(b.additionalProperties, false, op['x-cli'])
  }
})

test('서버 액션 인자에 형이 실린다', () => {
  const ops = [...byCli().values()].filter((o) => o['x-kind'] === 'action')
  const typed = ops.filter((o) => Object.values(bodyOf(o).properties ?? {}).some((p: Json) => p.type))
  assert.ok(typed.length > ops.length / 2, `형이 실린 액션 ${typed.length}/${ops.length}`)
})

test('fieldSchema 는 객체 인자의 속 칸과 필수를 옮긴다', () => {
  const s = fieldSchema({ name: 'input', type: 'object', fields: [{ name: 'a', type: 'number', required: true }, { name: 'b', type: 'string' }] })
  assert.deepEqual(s, { type: 'object', properties: { a: { type: 'number' }, b: { type: 'string' } }, required: ['a'] })
})
