/**
 * 사용량 화면 위 카드 셋이 늘 0 이던 것 (P0030 I17c)
 *
 * `total_tokens.sum()` 을 PostgREST 에 맡겼는데 이 프로젝트는 집계 함수를 꺼 두어 PGRST123 이 났다.
 * 오류를 안 읽어 카드가 늘 0 이었고, 이번 달 1,579,163 으로 임계치를 넘은 날에도 경고가 안 떴다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { sumTokens, kstBounds } from './token-summary.ts'

// 2026-10-29 10:00 KST
const NOW = new Date('2026-10-29T01:00:00Z')

test('KST 자정이 오늘의 시작이다 — UTC 자정이 아니다', () => {
  const { todayFromIso, monthFromIso } = kstBounds(NOW)
  assert.equal(todayFromIso, '2026-10-28T15:00:00.000Z')
  assert.equal(monthFromIso, '2026-09-30T15:00:00.000Z')
})

test('오늘, 이번 달, 누적을 경계대로 더한다', () => {
  const rows = [
    { created_at: '2026-10-28T16:00:00Z', total_tokens: 100 }, // 10-29 01:00 KST, 오늘
    { created_at: '2026-10-28T14:59:59Z', total_tokens: 20 }, // 10-28 23:59 KST, 어제
    { created_at: '2026-09-30T15:00:00Z', total_tokens: 3 }, // 10-01 00:00 KST, 이번 달 첫 순간
    { created_at: '2026-09-30T14:59:59Z', total_tokens: 4000 }, // 09-30 KST, 지난달
    { created_at: '2026-10-29T00:30:00Z', total_tokens: null }, // 토큰 없는 줄
  ]
  assert.deepEqual(sumTokens(rows, NOW), { today_tokens: 100, month_tokens: 123, total_tokens: 4123 })
})

test('줄이 없으면 0 이다', () => {
  assert.deepEqual(sumTokens([], NOW), { today_tokens: 0, month_tokens: 0, total_tokens: 0 })
})

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.next')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

/** select 문자열 안의 집계만. Prisma 의 .count() 는 문자열 밖이라 안 걸린다 */
const PG_AGGREGATE = /['"`][^'"`\n]*\w\.(sum|avg|count|min|max)\(\)[^'"`\n]*['"`]/

test('★ PostgREST 집계(.sum() 등)를 안 쓴다 — 꺼져 있어 오류가 나고 조용히 0 이 된다', () => {
  const hits = ['app', 'lib', 'components']
    .flatMap((d) => walk(join(process.cwd(), d)))
    .filter((f) => PG_AGGREGATE.test(strip(readFileSync(f, 'utf8'))))
    .map((f) => f.slice(process.cwd().length + 1))
  assert.deepEqual(hits, [])
})

test('★ 요약 창구가 읽기 오류를 읽고, 관리자 확인 뒤에 읽는다', () => {
  const route = strip(readFileSync(join(process.cwd(), 'app/api/admin/ai-usage/summary/route.ts'), 'utf8'))
  assert.match(route, /if \(error\)\s*\{[\s\S]*?status: 500/, '읽기 오류를 안 읽는다. 그러면 카드가 조용히 0 이 된다')
  assert.match(route, /sumTokens\(rows\)/)
  assert.ok(route.indexOf("profile.role !== 'admin'") < route.indexOf("from('ai_token_logs')"), '관리자 확인보다 읽기가 앞이다')
})
