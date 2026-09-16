/**
 * 카탈로그가 실제 개체를 가리키고 민감한 칸이 안 열려 있는지 본다
 *
 * **왜**: 카탈로그는 어시스턴트가 무엇을 볼 수 있는지 정하는 자리다.
 *   여기가 틀리면 **틀린 줄 모른 채** 어시스턴트가 답하고, 그 답이 새어 나간 뒤에 안다.
 *
 *   두 가지가 조용히 틀어진다.
 *   ① 없는 개체를 가리키는 등재: 화면에서는 안 보이고 카탈로그에만 남아 아무도 안 고친다
 *   ② 기본값이 열림인 칸: 나중에 더한 칸이 더한 날부터 읽히는데 아무도 결정하지 않았다
 *
 * 검사 셋:
 *   1) 카탈로그가 가리키는 개체는 용어집에 있는 개체다
 *   2) 민감한 칸이 기본으로 열려 있지 않다
 *   3) 규칙이 도는 대상이 실제로 있다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateCatalog, canRead, type Catalog } from '@ax/ai-core'
import { ENTITY } from '../terms/entity.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * 지금 저장소가 어시스턴트에 여는 것.
 *
 * 용어집이 아는 개체만 쓴다. 카탈로그가 자기 이름을 지으면 화면과 어시스턴트가
 * 다른 것을 가리키게 된다.
 */
export const APP_CATALOG: Catalog = {
  entities: [
    {
      key: 'deal',
      fields: [
        { name: 'title', sensitivity: 'open', describes: '딜 이름' },
        { name: 'stage', sensitivity: 'open', describes: '지금 어느 단계인가' },
        { name: 'amount', sensitivity: 'internal', describes: '계약 금액' },
        { name: 'cost', sensitivity: 'secret', describes: '우리 원가, 밖으로 안 나간다' },
      ],
    },
    {
      key: 'bid',
      fields: [
        { name: 'title', sensitivity: 'open', describes: '공고 이름' },
        { name: 'deadline', sensitivity: 'open', describes: '마감' },
        { name: 'basePrice', sensitivity: 'internal', describes: '기초금액' },
      ],
    },
  ],
  unlocked: [],
}

test('★ 카탈로그가 가리키는 개체는 용어집에 있다', () => {
  const unknown = APP_CATALOG.entities
    .map((e) => e.key)
    .filter((k) => !(k in ENTITY))
  assert.deepEqual(unknown, [], [
    '카탈로그가 용어집에 없는 개체를 가리킨다. 화면과 어시스턴트가 다른 것을 가리키게 된다:',
    ...unknown.map((u) => `  ${u}`),
  ].join('\n'))
})

test('★ 카탈로그 자체가 앞뒤가 맞는다', () => {
  assert.deepEqual(validateCatalog(APP_CATALOG), [])
})

test('★ 민감한 칸이 기본으로 열려 있지 않다', () => {
  const scope = { allowedIds: ['x'], actorId: 'u' }
  for (const e of APP_CATALOG.entities) {
    for (const f of e.fields) {
      if (f.sensitivity === 'open') continue
      const r = canRead(APP_CATALOG, e.key, f.name, 'x', scope)
      assert.equal(r.allowed, false,
        `${e.key}.${f.name} 이 ${f.sensitivity} 인데 그냥 읽힌다`)
    }
  }
})

test('★ 비밀 칸은 여는 목록에 없다', () => {
  const secrets = APP_CATALOG.entities.flatMap((e) =>
    e.fields.filter((f) => f.sensitivity === 'secret').map((f) => `${e.key}.${f.name}`))
  const opened = secrets.filter((p) => APP_CATALOG.unlocked.includes(p))
  assert.deepEqual(opened, [], `비밀 칸을 열어 뒀다: ${opened.join(', ')}`)
})

test('규칙이 도는 대상이 실제로 있다', () => {
  // 카탈로그가 비면 위 검사는 «위반 없음»으로 통과해 버린다
  assert.ok(APP_CATALOG.entities.length >= 2, '카탈로그가 비었다')
  const fields = APP_CATALOG.entities.flatMap((e) => e.fields)
  assert.ok(fields.length >= 5)
  assert.ok(fields.some((f) => f.sensitivity !== 'open'), '민감한 칸이 하나도 없으면 볼 것이 없다')
  // 용어집이 실제로 읽히는지도 본다
  assert.ok(Object.keys(ENTITY).length >= 10)
  assert.ok(readFileSync(join(WEB, 'lib/terms/entity.ts'), 'utf8').includes('bid'))
})
