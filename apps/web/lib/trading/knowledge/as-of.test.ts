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
  KNOWLEDGE_TABLES, visibleAsOf, futureCount, applyAsOf, availableNow, asOfContext,
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

test('★ 넣을 때 쓰는 값이 인자를 안 받는다 — 「그때도 알았던 것으로 해 두자」가 못 생긴다', () => {
  assert.equal(availableNow.length, 0, 'availableNow 가 인자를 받는다')
  const before = Date.now()
  const at = Date.parse(availableNow())
  assert.ok(at >= before && at <= Date.now() + 1000)
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

test('★ 지식 표에 available_at 을 손으로 써 넣는 자리가 0개다', () => {
  const offenders: string[] = []
  for (const { file, src } of sources()) {
    if (file === 'knowledge/as-of.ts') continue
    if (!KNOWLEDGE_TABLES.some((t) => src.includes(`'${t}'`))) continue
    // `available_at: <무언가>` 를 직접 적으면 시각을 고를 수 있게 된다
    if (/available_at\s*:/.test(src)) offenders.push(file)
  }
  assert.deepEqual(offenders, [],
    `available_at 을 손으로 넣는다 — 「그때도 알았던 것으로 해 두자」가 생긴다:\n  ${offenders.join('\n  ')}`)
})
