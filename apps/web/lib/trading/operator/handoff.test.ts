/**
 * 사람에게 넘기기 — **새 할 일 표를 안 만든다**
 *
 * 표를 하나 더 만들면 사람이 볼 곳이 하나 더 늘고, 둘 중 안 보게 되는 쪽은 대개
 * 새로 만든 쪽이다. 기존 업무 화면은 매일 열지만 「운영자 할 일」 화면은 무슨 일이 있어야 연다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handoffContent, WHAT_IS_NEEDED, priorityOf } from './handoff-content.ts'
import { CHECK_IDS, type CheckResult } from './checks.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = join(HERE, '..', '..', '..', '..', '..', 'supabase', 'migrations')

const CHECK: CheckResult = {
  id: 'broker_reachable',
  status: 'fail',
  reason: 'failures:3',
  userMessage: '증권사 조회가 3번 연속 실패했습니다',
  measured: { failureStreak: 3 },
}

test('★ 할 일에 무엇을·왜·무엇이 있으면 되는지 셋이 들어간다', () => {
  const body = handoffContent(CHECK)
  assert.ok(body.includes('증권사 조회가 3번 연속 실패했습니다'), '무엇이 없다')
  assert.ok(body.includes('왜: failures:3'), '왜가 없다')
  assert.ok(body.includes('failureStreak=3'), '잰 값이 없다')
  assert.ok(body.includes('할 일: '), '무엇이 있으면 되는지가 없다')
  assert.ok(body.startsWith('[AI 트레이딩]'), '어디서 온 할 일인지가 없다')
})

test('★ 점검 여덟에 전부 「무엇이 있으면 되는지」가 있다 — 없으면 사람이 다시 물어야 한다', () => {
  for (const id of CHECK_IDS) {
    assert.ok(WHAT_IS_NEEDED[id]?.length > 10, `${id} 에 할 일이 안 적혔다`)
  }
  // 죽은 항목이 남으면 목록이 거짓말을 한다
  const dead = Object.keys(WHAT_IS_NEEDED).filter((k) => !(CHECK_IDS as readonly string[]).includes(k))
  assert.deepEqual(dead, [], `없는 점검이 목록에 있다: ${dead.join(', ')}`)
})

test('모르는 점검에도 빈 글을 안 넣는다', () => {
  const body = handoffContent({ ...CHECK, id: 'unknown_check' as never })
  assert.ok(body.includes('할 일: '), '할 일 줄이 사라졌다')
  assert.ok(body.split('\n').length === 3)
})

test('★ 잰 값이 없을 때 「없음」이라 적는다 — 빈칸으로 두면 왜 그렇게 판정했는지 모른다', () => {
  const body = handoffContent({ ...CHECK, measured: { failureStreak: null } })
  assert.ok(body.includes('failureStreak=없음'))
})

// ── 새 할 일 표를 안 만든다 ──────────────────────────────

test('★ 트레이딩 마이그레이션에 할 일 표가 0개다', () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.startsWith('28') && f.includes('trading'))
  assert.ok(files.length >= 4, `트레이딩 마이그레이션이 ${files.length}개뿐이다`)
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
    const created = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)].map((m) => m[1])
    for (const t of created) {
      assert.equal(/task|todo|assignment|worklist/i.test(t), false,
        `${f} 가 할 일 표 ${t} 를 만든다 — 사람이 볼 곳이 하나 더 는다`)
    }
  }
})

test('★ 기존 업무 표에 넣는다 — daily_logs 로 간다', () => {
  const src = readFileSync(join(HERE, 'handoff.ts'), 'utf8')
  assert.ok(src.includes("from('daily_logs')"), '기존 업무 표에 안 넣는다')
  assert.ok(src.includes("entry_type: 'planned'"), '한 일로 넣는다 — 할 일이어야 한다')
  assert.ok(src.includes("source_type: 'ai_derived'"), 'AI 가 뽑은 것임을 안 남긴다')
  assert.ok(src.includes('is_resolved: false'), '이미 끝난 일로 넣는다')
})

test('★ 쓰는 표가 둘뿐이다 — 업무와 조치 기록', () => {
  const src = readFileSync(join(HERE, 'handoff.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  const tables = [...src.matchAll(/\.from\('(\w+)'\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(tables)].sort(), ['daily_logs', 'trading_operator_actions'])
})

// ── 같은 할 일이 날마다 안 쌓인다 ────────────────────────

test('★ 넘기기 전에 먼저 자리를 잡는다 — 업무를 먼저 넣으면 두 번 들어간다', () => {
  const src = readFileSync(join(HERE, 'handoff.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function handOff'))
  const recordAt = fn.indexOf('await recordAction(')
  const insertAt = fn.indexOf('await insertDailyLog(')
  assert.ok(recordAt > 0 && insertAt > 0)
  assert.ok(recordAt < insertAt,
    '업무를 먼저 넣는다 — 유일 인덱스가 막기 전에 들어가서 날마다 쌓인다')
  assert.ok(fn.includes('if (!claimed.saved) return { handed: false'),
    '이미 넘긴 것을 또 넘긴다')
})

test('★ DB 가 같은 날 같은 인계를 한 번으로 막는다', () => {
  const sql = readFileSync(join(MIGRATIONS, '286_trading_operator.sql'), 'utf8')
  assert.ok(sql.includes('uq_trading_operator_actions_handoff'), '인계 유일 인덱스가 없다')
  assert.ok(sql.includes("WHERE outcome = 'handed_off'"),
    '인계만이 아니라 모든 조치를 하나로 막는다 — 재시도까지 막힌다')
})

test('★ 업무를 못 넣어도 점검·조치 기록은 남는다', () => {
  const src = readFileSync(join(HERE, 'handoff.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function handOff'))
  assert.ok(fn.includes('try {') && fn.includes('} catch'), '감싸져 있지 않다')
  assert.ok(fn.includes('daily_log_failed:'), '실패 사유를 안 남긴다')
  // 실패해도 조치 기록을 지우지 않는다
  assert.equal(/\.delete\(/.test(fn), false, '실패가 기록을 지운다')
})

test('★ 급한 것이 급한 우선순위로 간다', () => {
  assert.equal(priorityOf('fail'), 'urgent')
  // 모르는 것은 경고보다 급하다 — 무엇이 문제인지조차 모른다
  assert.equal(priorityOf('unknown'), 'high')
  assert.equal(priorityOf('warn'), 'normal')
  assert.equal(priorityOf('ok'), 'normal')
  // daily_logs 가 받는 값만 쓴다
  for (const s of ['ok', 'warn', 'fail', 'unknown'] as const) {
    assert.ok(['urgent', 'high', 'normal', 'low'].includes(priorityOf(s)),
      `daily_logs 가 모르는 우선순위 ${priorityOf(s)}`)
  }
})
