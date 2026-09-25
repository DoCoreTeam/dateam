/**
 * as-of 규율 — **미래를 보고 치지 않는다**
 *
 * 오늘 쓴 글이 석 달 전 판단에 섞이면 그 백테스트는 미래를 본 것이고,
 * 성적은 좋게 나오고 실전에서는 재현되지 않는다. 화면에서는 똑같이 보인다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  KNOWLEDGE_TABLES, visibleAsOf, futureCount, applyAsOf, asOfContext,
} from './as-of.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const TRADING = join(HERE, '..')

const T0 = new Date('2026-06-01T00:00:00Z')
const row = (iso: string, id = iso) => ({ id, availableAt: new Date(iso) })

test('★ 여섯 표가 전부 규율 목록에 있다 — 빠진 표는 미래를 본다', () => {
  assert.deepEqual([...KNOWLEDGE_TABLES], [
    'trading_knowledge_cards', 'trading_source_analyses', 'trading_pattern_reports',
    'trading_spec_candidates', 'trading_signal_explanations', 'trading_exit_judgments',
  ])
})

test('★ 미래에 쓴 글이 과거 조회에 안 섞인다', () => {
  const rows = [row('2026-05-01T00:00:00Z'), row('2026-09-01T00:00:00Z')]
  assert.deepEqual(visibleAsOf(rows, T0).map((r) => r.id), ['2026-05-01T00:00:00Z'])
  assert.equal(futureCount(rows, T0), 1)
})

test('★ 경계는 포함이다 — 같은 순간에 쓴 것은 쓸 수 있다', () => {
  const rows = [row(T0.toISOString())]
  assert.equal(visibleAsOf(rows, T0).length, 1)
  assert.equal(visibleAsOf(rows, new Date(T0.getTime() - 1)).length, 0)
})

test('빈 목록과 전부 미래인 목록', () => {
  assert.deepEqual(visibleAsOf([], T0), [])
  assert.equal(futureCount([row('2027-01-01T00:00:00Z')], T0), 1)
})

test('질의에 as-of 를 건다', () => {
  const calls: [string, string][] = []
  const fake = { lte(c: string, v: string) { calls.push([c, v]); return fake } }
  applyAsOf(fake, T0)
  assert.deepEqual(calls, [['available_at', T0.toISOString()]])
})

test('★ 값을 만드는 함수 자체가 없다 — 통로가 없으면 고를 수도 없다', () => {
  const src = readFileSync(join(HERE, 'as-of.ts'), 'utf8')
  assert.equal(/export function available/.test(src), false,
    'available_at 값을 만드는 함수가 있다 — 그 함수에 인자가 붙는 날 시각을 고를 수 있게 된다')
  // DB 기본값이 박는다는 사실을 마이그레이션에서 확인한다
  const sql = readFileSync(
    join(HERE, '..', '..', '..', '..', '..', 'supabase', 'migrations', '285_trading_knowledge.sql'), 'utf8')
  const defaults = sql.match(/available_at\s+TIMESTAMPTZ NOT NULL DEFAULT now\(\)/g) ?? []
  assert.equal(defaults.length, KNOWLEDGE_TABLES.length,
    `available_at 기본값이 ${defaults.length}개다 — 표 ${KNOWLEDGE_TABLES.length}개 전부에 있어야 한다`)
})

test('★ AI 에게 넘기는 자료도 같은 규율을 지나고, 뺀 수가 남는다', () => {
  const rows = [row('2026-05-01T00:00:00Z'), row('2026-05-02T00:00:00Z'), row('2026-09-01T00:00:00Z')]
  const ctx = asOfContext(rows, T0, 10)
  assert.equal(ctx.used.length, 2)
  assert.equal(ctx.skippedFuture, 1, '뺀 수를 안 세면 「자료가 없었다」와 「가렸다」가 같아진다')
  // 상한이 있으면 자른다
  assert.equal(asOfContext(rows, T0, 1).used.length, 1)
  assert.equal(asOfContext(rows, T0, 0).used.length, 0)
})

// ── 규율이 실제로 지켜지나 ────────────────────────────────

function walk(dir: string): string[] {
  let out: string[] = []
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { out = out.concat(walk(full)); continue }
    if (!name.endsWith('.ts')) continue
    if (name.endsWith('.test.ts')) continue
    out.push(full)
  }
  return out
}

function sources(): { file: string; src: string }[] {
  return walk(TRADING).map((file) => ({
    file: relative(TRADING, file),
    src: readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1'),
  }))
}

test('★ 지식 표를 읽으면서 as-of 를 손으로 거는 자리가 0개다', () => {
  const offenders: string[] = []
  for (const { file, src } of sources()) {
    if (file === 'knowledge/as-of.ts') continue
    if (!/lte\(\s*'available_at'/.test(src)) continue
    // 봉과 월물은 1-A 때부터 자기 방식으로 건다. 지식 표만 이 규율을 받는다
    if (!KNOWLEDGE_TABLES.some((t) => src.includes(`'${t}'`))) continue
    offenders.push(file)
  }
  assert.deepEqual(offenders, [],
    `지식 표에 as-of 를 손으로 건다 — 한 곳을 빠뜨리면 그 자리가 조용히 미래를 본다:\n  ${offenders.join('\n  ')}`)
})

/**
 * `.insert({...})` · `.update({...})` 의 **인자 덩어리**만 잘라 낸다.
 *
 * 파일 전체에서 `available_at:` 를 찾으면 응답을 읽는 형 선언(`available_at: string`)까지
 * 잡힌다 — 읽는 것은 문제가 아니다. 쓰는 자리만 봐야 한다. 괄호 균형으로 자른다.
 */
function writeBodies(src: string): string[] {
  const out: string[] = []
  const re = /\.(insert|update|upsert)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    let depth = 0
    let i = m.index + m[0].length - 1
    const start = i
    for (; i < src.length; i += 1) {
      if (src[i] === '(') depth += 1
      else if (src[i] === ')') { depth -= 1; if (depth === 0) break }
    }
    out.push(src.slice(start, i + 1))
  }
  return out
}

test('★ 지식 표에 available_at 을 써 넣는 자리가 0개다 — DB 기본값이 박는다', () => {
  const offenders: string[] = []
  for (const { file, src } of sources()) {
    if (file === 'knowledge/as-of.ts') continue
    if (!KNOWLEDGE_TABLES.some((t) => src.includes(`'${t}'`))) continue
    for (const body of writeBodies(src)) {
      if (/available_at/.test(body)) offenders.push(file)
    }
  }
  assert.deepEqual([...new Set(offenders)], [],
    `available_at 을 써 넣는다 — 「그때도 알았던 것으로 해 두자」가 생긴다:\n  ${offenders.join('\n  ')}`)
})

test('★ 자르는 규칙이 실제로 쓰는 자리를 집는다 — 0개를 집으면 위 단정은 공회전이다', () => {
  const sample = "await admin.from('x').insert({ a: 1, b: f(2) }).select('id')"
  const bodies = writeBodies(sample)
  assert.equal(bodies.length, 1)
  assert.ok(bodies[0].includes('a: 1') && bodies[0].includes('b: f(2)'))
  assert.equal(bodies[0].includes('select'), false, '괄호 균형이 안 맞아 뒤까지 먹었다')
  // 읽는 형 선언은 안 집는다
  assert.deepEqual(writeBodies('interface R { available_at: string }'), [])
})
