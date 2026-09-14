/**
 * AI 결과는 판 번호 없이 저장되지 않는다
 *
 * **왜**: 값이 어떤 규칙으로 만들어졌는지는 **만들 때만** 안다. 안 적어 두면 규칙이 바뀌어도
 * 그 값은 영영 못 올린다. 무슨 규칙으로 쓰였는지 아무 데도 없기 때문이다.
 *
 * 실측 2026-09-14: AI 결과 칸(근거·확신·상태)을 가진 표가 **열다섯**인데 판 번호를 가진 표는
 * **0개**였다. 값이 더 쌓이기 전인 지금이 가장 싸다.
 *
 * 검사 넷:
 *   1) 등재된 표에 쓰는 코드가 판 번호를 같이 싣는다
 *   2) 판 번호를 손으로 적은 숫자로 두지 않는다 (계약이 올라도 그 파일만 옛 판을 적게 된다)
 *   3) 근거나 확신 칸을 가진 새 표가 생기면 판 번호 칸도 같이 만든다
 *   4) 규칙이 도는 대상이 실제로 있다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ROOT = join(WEB, '..', '..')
const REGISTRY = JSON.parse(
  readFileSync(join(WEB, 'lib/policy/ai-contract-tables.json'), 'utf8'),
) as { 표: string[]; 쓰는코드0곳: string[]; 제외: Record<string, string> }

interface Source { rel: string; src: string }

function sources(): Source[] {
  const out: Source[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.next')) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue
      if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue
      out.push({ rel: relative(WEB, full), src: readFileSync(full, 'utf8') })
    }
  }
  walk(join(WEB, 'lib'))
  walk(join(WEB, 'app'))
  return out
}

/**
 * `from('표')` **바로 다음에 오는 메서드**가 insert 나 upsert 인 자리.
 *
 * 구간을 넓게 훑으면 근처의 다른 insert 를 이 표의 쓰기로 잘못 센다(실제로 세 파일을
 * 잘못 잡았다). 체인의 첫 호출만 본다.
 */
function writeSites(table: string, f: Source): { at: number }[] {
  const hits: { at: number }[] = []
  const needle = `from('${table}')`
  let i = f.src.indexOf(needle)
  while (i !== -1) {
    const after = f.src.slice(i + needle.length, i + needle.length + 400)
    const first = after.match(/\.\s*([a-zA-Z]+)\s*\(/)
    if (first && (first[1] === 'insert' || first[1] === 'upsert')) hits.push({ at: i })
    i = f.src.indexOf(needle, i + 1)
  }
  return hits
}

test('★ AI 결과 표에 쓰는 코드는 판 번호를 같이 싣는다', () => {
  /*
    `.insert(rows)` 처럼 행을 **위에서 만들어 두고** 넘기는 코드가 많다. 그래서 호출 자리
    근처만 보면 멀쩡한 코드를 잡는다(실제로 네 곳을 잘못 잡았다).
    대신 «이 파일이 등재된 표에 쓰는 자리 수»와 «이 파일의 판 번호 등장 수»를 견준다.
    둘 중 하나만 박은 파일도 이 방식이면 걸린다.
  */
  const offenders: string[] = []
  for (const f of sources()) {
    let siteCount = 0
    const tables: string[] = []
    for (const table of REGISTRY.표) {
      const n = writeSites(table, f).length
      if (n > 0) { siteCount += n; tables.push(table) }
    }
    if (siteCount === 0) continue
    const stamped = (f.src.match(/contract_version/g) ?? []).length
    if (stamped < siteCount) {
      offenders.push(`${f.rel}  쓰는 자리 ${siteCount} 대 판 번호 ${stamped}  (${tables.join(', ')})`)
    }
  }
  assert.deepEqual(offenders, [], [
    'AI 결과를 판 번호 없이 저장한다. 그 값은 규칙이 바뀌어도 영영 못 올린다:',
    ...offenders.map((o) => `  ${o}`),
    '고치는 법: @ax/ai-core 의 AI_CONTRACT_VERSION 을 insert 에 같이 싣는다',
  ].join('\n'))
})

test('★ 판 번호를 손으로 적은 숫자로 두지 않는다', () => {
  const offenders: string[] = []
  for (const f of sources()) {
    for (const m of f.src.matchAll(/contract_version:\s*(\d+)/g)) {
      const line = f.src.slice(0, m.index ?? 0).split('\n').length
      offenders.push(`${f.rel}:${line}  contract_version: ${m[1]}`)
    }
  }
  assert.deepEqual(offenders, [], [
    '판 번호가 숫자로 박혀 있다. 계약이 올라도 이 자리만 옛 판을 계속 적고,',
    '그 사실은 데이터가 섞인 뒤에야 드러난다:',
    ...offenders.map((o) => `  ${o}`),
  ].join('\n'))
})

test('★ 근거나 확신 칸을 가진 표는 판 번호 칸도 갖는다', () => {
  const dir = join(ROOT, 'supabase', 'migrations')
  const declared = new Set<string>()
  const withAiFields = new Set<string>()
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.sql'))) {
    const sql = readFileSync(join(dir, name), 'utf8')
    for (const m of sql.matchAll(/create table (?:if not exists )?(\w+)\s*\(([\s\S]*?)\n\s*\)\s*;/gi)) {
      const [, table, body] = m
      declared.add(table)
      if (/\bevidence\b|\bconfidence\b/i.test(body)) withAiFields.add(table)
    }
    for (const m of sql.matchAll(/alter table (\w+)\s+add column[^;]*contract_version/gi)) {
      declared.add(m[1])
    }
  }
  const known = new Set(REGISTRY.표)
  // evidence 라는 칸 이름이 감사 로그에서는 「이 행동을 했다는 증거」를 뜻한다.
  // 이름이 같다고 같은 것이 아니라서, 제외는 사유와 함께 등재해 둔다
  const excluded = new Set(Object.keys(REGISTRY.제외))
  const missing = [...withAiFields].filter((t) => !known.has(t) && !excluded.has(t)).sort()
  assert.deepEqual(missing, [], [
    '근거나 확신 칸을 가진 표가 새로 생겼는데 판 번호 등재가 안 됐다.',
    'lib/policy/ai-contract-tables.json 에 더하고 마이그레이션에 contract_version 을 넣는다:',
    ...missing.map((t) => `  ${t}`),
  ].join('\n'))
})

test('규칙이 도는 대상이 실제로 있다', () => {
  // 경로나 패턴이 깨져 0개가 되면 위 검사는 «위반 없음»으로 통과해 버린다
  assert.ok(sources().length > 500, `훑은 파일이 ${sources().length}개뿐이다`)
  assert.equal(REGISTRY.표.length, 16)
  const files = sources()
  const written = REGISTRY.표.filter((t) => files.some((f) => writeSites(t, f).length > 0))
  assert.equal(
    written.length, REGISTRY.표.length - REGISTRY.쓰는코드0곳.length,
    `쓰는 코드가 있는 표가 ${written.length}개다. 등재와 실제가 어긋났는지 확인한다`,
  )
})
