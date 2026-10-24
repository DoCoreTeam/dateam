// 개발자센터 CLI 명령 참조 (P0168): 생성물에서 빠짐없이 만들고, 낱말 검색이 복수형을 넘는지
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ACTION_AREAS, ACTION_AREA_LABEL, ACTION_REF_COPY,
  buildActionEntries, curlExample, groupActions, sameWord, singular, wordsOf,
} from './action-ref.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const spec = JSON.parse(readFileSync(path.join(here, '../actions/generated/openapi.json'), 'utf8'))
const entries = buildActionEntries(spec)

function sourceCount(): number {
  let n = 0
  for (const item of Object.values(spec.paths ?? {}) as Array<Record<string, { 'x-cli'?: string }>>) {
    for (const op of Object.values(item)) if (op?.['x-cli']) n += 1
  }
  return n
}

test('항목 수가 생성물의 x-cli 동작 수와 같다', () => {
  const n = sourceCount()
  assert.ok(n >= 700, `생성물 동작 ${n}개`)
  assert.equal(entries.length, n)
})

test('모든 항목에 영역과 teamda 명령과 경로가 있다', () => {
  for (const e of entries) {
    assert.ok((ACTION_AREAS as readonly string[]).includes(e.area), e.id)
    assert.ok(e.areaLabel.length > 0, e.id)
    assert.match(e.command, /^teamda \S/, e.id)
    assert.ok(e.path.startsWith('/'), e.id)
    assert.ok(e.cliExample.startsWith(e.command), e.id)
  }
})

test('빈 검색어는 전부를 영역 순서로 묶는다', () => {
  const r = groupActions(entries)
  assert.equal(r.count, entries.length)
  assert.equal(r.groups.reduce((s, g) => s + g.entries.length, 0), entries.length)
  const order = r.groups.map((g) => ACTION_AREAS.indexOf(g.area))
  assert.deepEqual(order, [...order].sort((a, b) => a - b))
})

test('「crm companies」 가 crm company 명령과 /companies 경로를 찾는다', () => {
  const r = groupActions(entries, 'crm companies')
  const hits = r.groups.flatMap((g) => g.entries)
  assert.ok(hits.some((e) => e.command === 'teamda crm company list'), 'crm company list')
  assert.ok(hits.some((e) => e.path === '/crm/companies'), '/crm/companies')
  assert.ok(hits.every((e) => e.area === 'crm'), '다른 영역이 섞이지 않는다')
  assert.equal(r.count, hits.length)
  // 낱말 순서와 대소문자는 상관없다
  assert.equal(groupActions(entries, 'Company CRM').count, r.count)
})

test('없는 낱말은 묶음 0개, 빈 상태 문구가 있다', () => {
  const r = groupActions(entries, 'zzqx nonsenseword')
  assert.equal(r.groups.length, 0)
  assert.equal(r.count, 0)
  assert.ok(ACTION_REF_COPY.empty.length > 0)
})

test('복수형 정규화', () => {
  assert.equal(singular('companies'), 'company')
  assert.equal(singular('company'), 'company')
  assert.equal(singular('boxes'), 'box')
  assert.equal(singular('deals'), 'deal')
  assert.equal(singular('status'), 'status')
  assert.equal(singular('class'), 'class')
  assert.ok(sameWord('Companies', 'company'))
  assert.ok(sameWord('statuses', 'status'))
  assert.ok(sameWord('aliases', 'alias'))
  assert.ok(!sameWord('company', 'deal'))
})

test('낱말 쪼개기는 경로 기호와 낙타 꼴에서 끊는다', () => {
  assert.deepEqual(wordsOf('/crm/companies/{id}/fill-domains'), ['crm', 'companies', 'id', 'fill', 'domains'])
  assert.deepEqual(wordsOf('addKnowledgeText'), ['add', 'knowledge', 'text'])
})

test('경로 변수는 예시에서 자리표시가 된다', () => {
  const get = entries.find((e) => e.method === 'GET' && e.path === '/crm/companies/{id}')
  assert.ok(get)
  assert.match(get.cliExample, /<id>/)
  const curl = curlExample(get, 'https://example.test/api/public/v1')
  assert.match(curl, /\/crm\/companies\/<id>/)
  assert.match(curl, /X-API-Key/)
})

test('영역 이름표가 생성기(scripts/cli/gen.mjs)와 같다', () => {
  const gen = readFileSync(path.join(here, '../../../../scripts/cli/gen.mjs'), 'utf8')
  const areas = /const AREAS = \[([^\]]+)\]/.exec(gen)?.[1]
  assert.ok(areas)
  assert.deepEqual(areas.split(',').map((s) => s.trim().replace(/'/g, '')), [...ACTION_AREAS])
  for (const a of ACTION_AREAS) assert.ok(gen.includes(`${a}: '${ACTION_AREA_LABEL[a]}'`), a)
})

test('등록부에 본문 예시가 있는 동작은 teamda 와 curl 예시가 그 본문을 싣는다', () => {
  const withBody = entries.filter((e) => e.bodyExample)
  assert.ok(withBody.length >= 10, `본문 예시가 붙은 동작 ${withBody.length}`)
  const create = entries.find((e) => e.method === 'POST' && e.path === '/crm/companies')
  assert.ok(create?.bodyExample, 'POST /crm/companies 본문 예시')
  for (const key of Object.keys(create.bodyExample)) {
    assert.ok(create.cliExample.includes(`"${key}"`), `teamda 예시에 ${key}`)
    assert.ok(curlExample(create, 'https://x.test/api/public/v1').includes(`"${key}"`), `curl 예시에 ${key}`)
  }
  assert.ok(!create.cliExample.includes("--json '{}'"))
})
